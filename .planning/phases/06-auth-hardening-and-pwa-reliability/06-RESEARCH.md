# Phase 6: Auth Hardening and PWA Reliability - Research

**Researched:** 2026-03-17
**Domain:** Microsoft identity PKCE token refresh, PWA install prompts (iOS/Android), offline upload queue
**Confidence:** HIGH (INFRA-02 and INFRA-01 patterns verified against official Microsoft and MDN docs; INFRA-03 browser support confirmed from MDN and Smashing Magazine 2025)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Home Screen install prompt for iOS/Android | iOS requires manual-step banner (no beforeinstallprompt); Android triggers beforeinstallprompt when manifest + SW criteria met; manifest.json needs start_url and scope aligned to GitHub Pages path |
| INFRA-02 | Silent token refresh (no re-login interruption after 1 hour) | PKCE SPA tokens come with a 24-hour rotating refresh_token when offline_access scope is included; custom refresh_token grant replaces MSAL entirely; no redirect needed for up to 24 hours |
| INFRA-03 | Offline queue for uploads, sync when reconnected | Background Sync API not supported on iOS Safari; manual online event listener + IndexedDB queue is the cross-browser fallback; queue stores serialized upload jobs including PDF blob |
</phase_requirements>

---

## Summary

Phase 6 addresses three production-reliability concerns that do not appear in developer testing but will hit users in the field: auth token expiry mid-upload, no install pathway on phones, and dropped uploads on poor cellular.

**INFRA-02 (Silent token refresh)** is the most nuanced. The current PKCE implementation in `app/graph/auth.js` requests the `Files.ReadWrite User.Read` scopes but does NOT include `offline_access`. Without `offline_access`, the token response has no `refresh_token` and silent refresh is impossible. Adding `offline_access` to the scope request causes Microsoft Entra to return a `refresh_token` alongside the access token. SPAs registered with a `spa` redirect URI type receive rotating refresh tokens valid for 24 hours. The custom PKCE code can then POST to `/oauth2/v2.0/token` with `grant_type=refresh_token` to silently get a new access token — no MSAL.js library required. MSAL.js is NOT recommended for this project: its CDN was deprecated at v3.0.0 (only installable via npm/bundler), and the minified build is ~270KB — a significant cost for a no-build-step vanilla JS project. The correct approach is extending the existing custom auth module.

**INFRA-01 (Install prompt)** is platform-specific. Android Chrome fires `beforeinstallprompt` when the manifest passes installability criteria; the event can be deferred and shown at the right moment. iOS Safari does not support `beforeinstallprompt` at all — Apple has not added it. The only approach on iOS is a custom instructional banner that detects `navigator.standalone === false` on iOS and shows share-sheet instructions. The current `manifest.json` has `"start_url": "/"` which is wrong for GitHub Pages subdirectory deployment (`/camiora-maintenance/`) and will cause the installability check to fail on Android.

**INFRA-03 (Offline queue)** requires an IndexedDB queue because the Background Sync API is not supported on iOS Safari (Chromium-only as of 2025). The correct cross-browser pattern is: detect offline at upload time, persist the upload job (PDF Blob + metadata) to IndexedDB, listen for `window.addEventListener('online', ...)` in `main.js`, and drain the queue when connectivity restores. The service worker `fetch` handler does NOT need to change for this — the queue is managed in the app layer, not the SW.

**Primary recommendation:** Extend the existing custom auth module to add `offline_access` scope and a `refreshAccessToken()` function. Do not introduce MSAL.js. Build the install prompt as a native UI component, not a library. Build the offline queue in the app layer using IndexedDB (already present from `app/storage/cache.js`).

---

## Standard Stack

### Core
| Library / API | Version | Purpose | Why Standard |
|--------------|---------|---------|--------------|
| Existing `app/graph/auth.js` | (custom) | Extended with refresh_token grant | No new dependency; same pattern as existing PKCE code |
| IndexedDB (`app/storage/cache.js`) | (built-in) | Offline upload queue storage | Already used for fleet cache; same pattern applies to upload queue |
| `window.addEventListener('online')` | (built-in) | Trigger queue drain on reconnect | Cross-browser, including iOS Safari; no library needed |
| `beforeinstallprompt` (Android only) | (built-in) | Deferred install banner on Android | Standard Chrome/Edge pattern; fires when manifest is valid |
| `navigator.standalone` (iOS only) | (built-in) | Detect if running as installed PWA | Safari-specific; tells you whether to show the "add to home screen" instructions |

### Supporting
| Library / API | Version | Purpose | When to Use |
|--------------|---------|---------|-------------|
| `navigator.onLine` | (built-in) | Quick sync-status check before upload | Guard in `handleSubmit` before attempting Graph API calls |
| `StorageManager.persist()` | (built-in) | Request persistent storage (prevents iOS 7-day eviction) | Call after Home Screen install confirmed; best-effort, auto-granted for installed PWAs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom refresh_token grant | MSAL.js `@azure/msal-browser` | MSAL CDN deprecated at v3; must use npm/bundler (~270KB min); breaks no-build-step constraint; not worth it |
| Background `online` event queue | Service Worker Background Sync | Background Sync is Chromium-only; iOS Safari (primary target) does not support it |
| Manual iOS install banner | `beforeinstallprompt` on iOS | Apple has not implemented this event; no alternative exists |

**Installation:** No new packages. All capabilities use built-in browser APIs and extensions to existing modules.

---

## Architecture Patterns

### Recommended Project Structure Changes
```
app/
├── graph/
│   └── auth.js              # Add: offline_access scope, refreshAccessToken(), getValidToken()
├── storage/
│   ├── cache.js             # Existing fleet cache (unchanged)
│   └── uploadQueue.js       # NEW: IndexedDB queue for pending uploads
├── views/
│   └── upload.js            # Add: offline guard, queue-on-fail path
└── main.js                  # Add: online event listener, queue drain call, install prompt logic
```

### Pattern 1: Refresh Token Grant (INFRA-02)

**What:** When the access token is within 5 minutes of expiry, silently exchange the stored refresh_token for a new access_token + refresh_token pair using a direct POST to the token endpoint.

**When to use:** Call `getValidToken()` instead of `state.token` before every Graph API call. The function checks expiry and calls `refreshAccessToken()` if needed.

**Critical prerequisite:** Add `offline_access` to `SCOPES` in `auth.js`. Without it, the initial token exchange does NOT return a `refresh_token`. The existing code has `SCOPES = 'Files.ReadWrite User.Read'` — this must become `'Files.ReadWrite User.Read offline_access'`.

**Refresh token lifetime:** For SPAs with a `spa`-type redirect URI, rotating refresh tokens have a 24-hour lifetime. After 24 hours of continuous inactivity, interactive re-auth is required. This is a known Microsoft limitation for SPAs. It does not affect normal field use (users authenticate at least daily).

**Token storage:** The refresh_token must be stored in `sessionStorage` alongside the access token (same pattern as existing `ms_token`). Clear it on `signOut()`.

**Example:**
```javascript
// Source: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
// In app/graph/auth.js

export const SCOPES = 'Files.ReadWrite User.Read offline_access'; // ADD offline_access

export function saveToken(tokenData) {
  const exp = Date.now() + (tokenData.expires_in || 3600) * 1000;
  sessionStorage.setItem('ms_token', tokenData.access_token);
  sessionStorage.setItem('ms_token_exp', exp);
  if (tokenData.refresh_token) {
    sessionStorage.setItem('ms_refresh_token', tokenData.refresh_token);
  }
  state.token = tokenData.access_token;
  state.tokenExp = exp;
}

export async function refreshAccessToken() {
  const refreshToken = sessionStorage.getItem('ms_refresh_token');
  if (!refreshToken) return false;

  const body = new URLSearchParams({
    client_id:     CONFIG.CLIENT_ID,
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    scope:         SCOPES,
  });

  const resp = await fetch(
    `https://login.microsoftonline.com/${CONFIG.TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  );

  if (!resp.ok) return false;

  const data = await resp.json();
  saveToken(data);
  return true;
}

// Call this before every Graph API call instead of reading state.token directly
export async function getValidToken() {
  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  if (!state.token) return null;
  if (state.tokenExp - Date.now() < REFRESH_THRESHOLD_MS) {
    const ok = await refreshAccessToken();
    if (!ok) return null; // Caller must handle — trigger re-login
  }
  return state.token;
}
```

### Pattern 2: iOS Install Banner (INFRA-01)

**What:** Detect platform and install state, show an instructional banner with share-sheet steps on iOS, and show a deferred `beforeinstallprompt` button on Android.

**When to use:** Show the banner once per session if the app is not already installed (detected via `window.matchMedia('(display-mode: standalone)').matches` or `navigator.standalone`). Dismiss on tap and store dismissal in sessionStorage to avoid repeat nags.

**iOS detection:** `navigator.userAgent` containing `iPhone` or `iPad` combined with `navigator.standalone === false`. Do NOT use `beforeinstallprompt` on iOS — it never fires.

**manifest.json fix required:** The current `"start_url": "/"` resolves to the GitHub Pages root. For deployment at `https://alexubt.github.io/camiora-maintenance/`, both `start_url` and `scope` must be set to the repository subpath.

**Example:**
```javascript
// Source: MDN - Making PWAs installable
// In app/main.js — run after DOMContentLoaded

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
}

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showAndroidInstallBanner(); // Show a custom "Install App" button
});

function initInstallPrompt() {
  if (isInstalled()) return; // Already installed — don't nag
  if (sessionStorage.getItem('install_dismissed')) return;

  if (isIOS()) {
    showIOSInstallBanner(); // Static instructions: tap Share > Add to Home Screen
  }
  // Android: banner shown when beforeinstallprompt fires (above)
}

function showIOSInstallBanner() {
  // Render an instructional UI element; tap to dismiss -> sessionStorage.setItem('install_dismissed', '1')
}
```

**manifest.json correction:**
```json
{
  "start_url": "/camiora-maintenance/",
  "scope": "/camiora-maintenance/"
}
```
(All other manifest fields are already correct: `display: standalone`, 192px + 512px icons with `any maskable` purpose.)

### Pattern 3: Offline Upload Queue (INFRA-03)

**What:** When an upload is attempted while offline (or fails with a network error), serialize the upload job to IndexedDB and retry when online.

**When to use:** Wrap the upload in `handleSubmit` with an `navigator.onLine` guard. Listen for `window.addEventListener('online', drainUploadQueue)` in `main.js`.

**What to store:** Each queue entry needs enough data to reconstruct the upload without requiring user input again: `{ id, pdfBlob, remotePath, csvAppend: { unitId, date, type, cost }, queuedAt }`.

**Background Sync API:** Do NOT use it. It is Chromium-only and does not work on iOS Safari. The `online` event listener is the correct cross-browser approach.

**Queue drain strategy:** Drain serially (one upload at a time) to avoid concurrent writes to the CSV. Show a status notification to the user when a queued upload completes.

**Example:**
```javascript
// Source: MDN Web Docs - online/offline events, IndexedDB
// In app/storage/uploadQueue.js (new file)

const DB_NAME = 'camiora';
const STORE   = 'uploadQueue';

export async function enqueueUpload(job) {
  // job: { pdfBlob, remotePath, csvAppend: { unitId, date, type, cost } }
  const db = await openQueueDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({ ...job, id: Date.now(), queuedAt: new Date().toISOString() });
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function dequeueAll() {
  // Returns all queued jobs; caller removes each after successful upload
}

export async function removeJob(id) {
  // Delete one job by id after successful upload
}
```

```javascript
// In app/main.js — online event listener
import { dequeueAll, removeJob } from './storage/uploadQueue.js';
import { uploadFile } from './graph/files.js';
import { appendInvoiceRecord } from './invoice/record.js';

window.addEventListener('online', async () => {
  const jobs = await dequeueAll();
  for (const job of jobs) {
    try {
      const file = new File([job.pdfBlob], job.remotePath.split('/').pop(), { type: 'application/pdf' });
      await uploadFile(file, job.remotePath);
      await appendInvoiceRecord(job.csvAppend);
      await removeJob(job.id);
      // Show toast: "Queued upload for UNIT_DATE_TYPE.pdf completed"
    } catch (err) {
      console.warn('Queue drain failed for job', job.id, err);
      break; // Stop draining on failure; retry next time online
    }
  }
});
```

### Anti-Patterns to Avoid
- **Adding `offline_access` without storing the refresh_token**: The token exchange already returns it; if `saveToken()` doesn't persist it, silent refresh is impossible. Update `saveToken()` in the same commit as the scope change.
- **Calling `state.token` directly in Graph API calls**: Every API call must go through `getValidToken()` to get a pre-checked, possibly-refreshed token.
- **Using Background Sync API as the primary queue mechanism**: It won't fire on iOS. Use it as an enhancement only — detect support with `'SyncManager' in window` and fall back to the `online` event.
- **Showing the iOS install banner immediately on first load**: Wait for the fleet data to load and the first useful screen to render; showing it during boot creates a bad first impression.
- **Setting `"start_url": "/"` on GitHub Pages**: The app is hosted at a subdirectory. Android Chrome's installability check will fail if `start_url` is outside the registered `scope`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Silent token refresh | iframe-based silent auth, hidden redirect | `grant_type=refresh_token` POST | Hidden iframes break in Safari (third-party cookie blocking); the token endpoint POST is simpler and works everywhere |
| Token expiry check | Complex timer-based background refresh | Check expiry in `getValidToken()` on every API call | Timer-based refresh can fire when app is inactive; lazy check-before-call is simpler and never wastes a refresh on a session the user abandoned |
| MSAL.js | Custom PKCE implementation replacement | Keep existing custom PKCE, extend with refresh | MSAL CDN deprecated at v3; requires bundler; ~270KB minified; adds a build step to a deliberately no-build project |
| iOS install detection | Complex UA parsing | `navigator.standalone` + UA check | Safari provides `navigator.standalone` exactly for this purpose |

---

## Common Pitfalls

### Pitfall 1: Missing `offline_access` Scope — No Refresh Token Returned
**What goes wrong:** The token exchange succeeds but the response has no `refresh_token` field. `refreshAccessToken()` finds `ms_refresh_token` as null and returns false. Every call to `getValidToken()` after 60 minutes returns null. Users get re-login prompts.
**Why it happens:** Microsoft Entra only returns a `refresh_token` when the `offline_access` scope is explicitly requested. It is not implied by `Files.ReadWrite` or `User.Read`.
**How to avoid:** Update `SCOPES` constant to include `offline_access` before any other work in this phase. Verify the initial token response contains a `refresh_token` field.
**Warning signs:** `sessionStorage.getItem('ms_refresh_token')` is null after a fresh login.

### Pitfall 2: Rotating Refresh Tokens — Old Token Discarded
**What goes wrong:** The app holds a stale refresh_token (from a previous call) and tries to use it. Microsoft returns `invalid_grant`. The user is silently signed out.
**Why it happens:** Every time a refresh_token is used, Microsoft returns a NEW refresh_token and invalidates the old one. If the app keeps a cached copy of the old token (e.g., in-memory in `state`) it will fail on the next refresh cycle.
**How to avoid:** Always write the new `refresh_token` back to `sessionStorage` in `saveToken()` every time a refresh succeeds. Never cache the refresh token in `state` (keep it only in `sessionStorage`).
**Warning signs:** Silent refresh works once, then fails on the second attempt.

### Pitfall 3: `start_url` / `scope` Mismatch on GitHub Pages
**What goes wrong:** Android Chrome does not show the `beforeinstallprompt` event. Lighthouse PWA audit fails on "Installable".
**Why it happens:** The current manifest has `"start_url": "/"`. The app is served from `https://alexubt.github.io/camiora-maintenance/`. Chrome requires `start_url` to be within the registered `scope`, and both must be paths the service worker can control.
**How to avoid:** Set both `start_url` and `scope` to `/camiora-maintenance/` in `manifest.json`. Update `sw.js` `STATIC` cache list to use absolute paths starting with `/camiora-maintenance/` if the SW scope requires it.
**Warning signs:** `beforeinstallprompt` never fires on Android; Chrome DevTools Application tab shows manifest errors.

### Pitfall 4: PDF Blob Not Serializable to IndexedDB
**What goes wrong:** `enqueueUpload()` fails or stores a corrupted entry. When the queue drains, the upload fails with an invalid body.
**Why it happens:** A `File` object is not directly serializable; it must be stored as a raw `Blob`. Also, the `ArrayBuffer` from jsPDF's `output('arraybuffer')` is transferable but must be explicitly stored as binary.
**How to avoid:** Store the PDF as a `Blob` (which IndexedDB handles natively). Reconstruct a `File` from the `Blob` when draining. Do NOT store the `File` object directly.
**Warning signs:** Queue entries exist in IndexedDB but drain attempts throw `DOMException: DataCloneError`.

### Pitfall 5: Queue Drain Attempts Without Valid Token
**What goes wrong:** The `online` event fires before the user has authenticated (e.g., on boot). The drain attempts Graph API calls with `state.token === null` and fails silently.
**How to avoid:** Guard the queue drain with `if (!state.token) return;` and call `getValidToken()` before each drain job.

### Pitfall 6: iOS Install Banner Shown When Already Installed
**What goes wrong:** Users who added the app to their Home Screen still see the "Add to Home Screen" banner every session because `navigator.standalone` is checked incorrectly.
**Why it happens:** In standalone PWA mode, `navigator.standalone` is `true`. The check must be `!navigator.standalone` (and check `display-mode: standalone` media query as a fallback for non-Safari browsers).
**How to avoid:** Use `isInstalled()` function that checks both `navigator.standalone` and the `display-mode: standalone` media query.

---

## Code Examples

### Checking `offline_access` in Token Response
```javascript
// After exchangeCodeForToken(), verify refresh_token is present
const tokenData = await exchangeCodeForToken(code);
if (tokenData?.access_token) {
  saveToken(tokenData); // saveToken must now store tokenData.refresh_token
  console.assert(sessionStorage.getItem('ms_refresh_token'), 'No refresh_token — check offline_access scope');
}
```

### Graph API Call Wrapper Using `getValidToken()`
```javascript
// Source: existing pattern in app/graph/files.js — extend to use getValidToken()
import { getValidToken } from './auth.js';

export async function uploadFile(file, remotePath) {
  const token = await getValidToken();
  if (!token) throw new Error('AUTH_EXPIRED'); // Caller renders re-login prompt

  const encoded = remotePath.split('/').map(encodeURIComponent).join('/');
  const resp = await fetch(`${GRAPH}/me/drive/root:/${encoded}:/content`, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!resp.ok) throw new Error(`Upload failed ${resp.status}`);
  return resp.json();
}
```

### Correct manifest.json for GitHub Pages
```json
{
  "name": "Camiora Maintenance",
  "short_name": "Camiora",
  "description": "Fleet maintenance record upload",
  "start_url": "/camiora-maintenance/",
  "scope": "/camiora-maintenance/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0F6E56",
  "orientation": "portrait",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hidden iframe silent refresh | refresh_token grant POST | Third-party cookie deprecation (Safari first, Chrome phasing) | iframe silent auth broken in Safari; token endpoint POST works everywhere |
| MSAL CDN script tag | npm/bundler only | MSAL.js v3.0.0 (2024) | CDN access removed; no-build-step projects cannot use MSAL v3+ |
| Background Sync for offline queue | online event + IndexedDB queue | Ongoing (Safari never adopted Background Sync) | Background Sync remains Chromium-only; manual queue is the cross-browser standard |
| `beforeinstallprompt` everywhere | Android-only; manual banner for iOS | Apple has never implemented it | iOS install guidance is always a manual user-education step |

**Deprecated/outdated:**
- **Hidden iframe silent auth**: Works only on Chrome with third-party cookies enabled. Safari blocks it. Do not use.
- **MSAL.js CDN (v2.x alcdn.msauth.net)**: Still technically accessible but Microsoft states these are no longer maintained. Do not rely on them.
- **`prompt=none` redirect for silent auth on mobile**: Causes a full-page redirect; loses app state. Use refresh_token grant instead.

---

## Open Questions

1. **`start_url` and `scope` exact value**
   - What we know: App is deployed at `https://alexubt.github.io/camiora-maintenance/`; current `start_url` is `"/"` which is wrong
   - What's unclear: Whether the `scope` field also needs to be set, or if browsers infer it from `start_url`
   - Recommendation: Set both explicitly to `/camiora-maintenance/` — MDN confirms scope defaults to the start_url's directory when omitted, but explicit is safer and more consistent

2. **Queue UX — how to notify users of pending uploads**
   - What we know: Uploads may sit in queue for minutes or hours
   - What's unclear: Whether a persistent status indicator (e.g., badge or notification) is expected
   - Recommendation: Simple toast notification when a queued upload completes; no persistent badge needed for v1

3. **Re-login UX after 24-hour refresh token expiry**
   - What we know: After 24h of inactivity, the refresh_token expires and interactive re-auth is required
   - What's unclear: Whether a queued upload that aged more than 24 hours should be retried (token expired) or abandoned
   - Recommendation: On `AUTH_EXPIRED` during queue drain, show a "Please sign in to complete X pending uploads" message; preserve the queue and re-drain after login

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (established in Phase 1) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test app/graph/auth.test.js app/storage/uploadQueue.test.js` |
| Full suite command | `node --test app/**/*.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-02 | `getValidToken()` returns current token when not near expiry | unit | `node --test app/graph/auth.test.js` | ❌ Wave 0 |
| INFRA-02 | `getValidToken()` calls `refreshAccessToken()` when < 5 min remain | unit | `node --test app/graph/auth.test.js` | ❌ Wave 0 |
| INFRA-02 | `refreshAccessToken()` POSTs refresh_token grant and stores new tokens | unit | `node --test app/graph/auth.test.js` | ❌ Wave 0 |
| INFRA-02 | `refreshAccessToken()` returns false when no refresh_token in storage | unit | `node --test app/graph/auth.test.js` | ❌ Wave 0 |
| INFRA-03 | `enqueueUpload()` writes a job to IndexedDB | unit | `node --test app/storage/uploadQueue.test.js` | ❌ Wave 0 |
| INFRA-03 | `dequeueAll()` returns all queued jobs | unit | `node --test app/storage/uploadQueue.test.js` | ❌ Wave 0 |
| INFRA-03 | `removeJob(id)` deletes a specific job | unit | `node --test app/storage/uploadQueue.test.js` | ❌ Wave 0 |
| INFRA-01 | `isInstalled()` returns true in standalone mode | unit | `node --test app/main.test.js` | ❌ Wave 0 |
| INFRA-01 | `isIOS()` correctly detects iOS UA strings | unit | `node --test app/main.test.js` | ❌ Wave 0 |

**Manual verification required:**
- INFRA-01: iOS install banner displays correctly in Safari (cannot be automated — requires device)
- INFRA-01: Android `beforeinstallprompt` fires and install button triggers install (requires Android device + Chrome)
- INFRA-02: Actual token refresh works after 60 minutes (requires waiting; integration test only)
- INFRA-03: Offline queue drains after toggling airplane mode on phone (device test)

### Sampling Rate
- **Per task commit:** `node --test app/graph/auth.test.js app/storage/uploadQueue.test.js`
- **Per wave merge:** `node --test app/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `app/graph/auth.test.js` — extended test file covering `getValidToken`, `refreshAccessToken`, token storage (covers INFRA-02)
- [ ] `app/storage/uploadQueue.test.js` — new file covering `enqueueUpload`, `dequeueAll`, `removeJob` (covers INFRA-03)
- [ ] `app/main.test.js` — new file covering `isIOS`, `isInstalled` (covers INFRA-01 logic path)

Note: IndexedDB is not available in Node.js test runner. `uploadQueue.test.js` will need to mock or stub the IndexedDB calls (inject a fake db implementation). Existing `cache.js` tests in Phase 1 used this pattern — confirm with `app/storage/cache.js` tests for the mocking approach.

---

## Sources

### Primary (HIGH confidence)
- [Microsoft Entra: OAuth 2.0 auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) — refresh_token grant parameters, SPA token response, `offline_access` requirement; updated 2026-01-09
- [Microsoft Entra: Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens) — 24-hour SPA refresh token lifetime, rotating token behavior; updated 2025-11-05
- [Microsoft Entra: Acquire token in SPA](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-acquire-token) — MSAL `acquireTokenSilent` + popup fallback pattern; updated 2025-10-02
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) — `beforeinstallprompt` scope, iOS limitations
- [MDN: Web app manifest `start_url`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url) — GitHub Pages subdirectory requirements

### Secondary (MEDIUM confidence)
- [Smashing Magazine: Building an offline-friendly image upload system (April 2025)](https://www.smashingmagazine.com/2025/04/building-offline-friendly-image-upload-system/) — IndexedDB queue + Background Sync pattern; confirms Background Sync is Chromium-only
- [MSAL.js v3 CDN deprecation — devblogs.microsoft.com](https://devblogs.microsoft.com/identity/msal-js-v3-release/) — MSAL CDN deprecated at v3.0.0
- [MSAL.js bundle size issue #6702](https://github.com/AzureAD/microsoft-authentication-library-for-js/issues/6702) — minified size confirmed ~270KB for v3.5.0
- [mobiloud.com: PWA on iOS complete guide 2026](https://www.mobiloud.com/blog/progressive-web-apps-ios) — iOS `beforeinstallprompt` absence confirmed; manual banner required

### Tertiary (LOW confidence)
- Community Q&A and blog posts on iOS PWA install UX — corroborate `navigator.standalone` detection pattern (multiple sources agree)

---

## Metadata

**Confidence breakdown:**
- INFRA-02 (Token refresh): HIGH — verified against official Microsoft Entra docs (2025-2026), specific parameters confirmed
- INFRA-01 (Install prompt): HIGH for iOS limitation (MDN + Apple sources confirm); MEDIUM for exact manifest fix (inferred from MDN start_url docs + known deployment URL)
- INFRA-03 (Offline queue): HIGH for Background Sync iOS non-support; HIGH for `online` event fallback pattern

**Research date:** 2026-03-17
**Valid until:** 2026-09-17 (stable APIs; token lifetime policy changes could move this earlier — check Microsoft Entra changelog if > 3 months pass)

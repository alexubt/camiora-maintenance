# Pitfalls Research

**Domain:** Fleet maintenance PWA — Excel/OneDrive as database, client-side image processing, iOS/Android mobile
**Researched:** 2026-03-16
**Confidence:** HIGH (most findings backed by official Microsoft docs and WebKit sources)

---

## Critical Pitfalls

### Pitfall 1: Excel Concurrent Write Corruption

**What goes wrong:**
Two fleet team members submit invoices at the same moment. Both clients read the current Excel row count, both decide to append row 47, and both write. One write silently overwrites the other. The codebase currently has no session management, no row locking, and no conflict detection — it will use raw PUT/PATCH to the file, not the Excel workbook API.

**Why it happens:**
The natural approach — read the file, parse it, append a row, write the file back — is a read-modify-write cycle. On a shared file this is a TOCTOU (time-of-check to time-of-use) race. Microsoft Graph's Excel workbook API has a session system specifically to prevent this, but the simpler approach of uploading a replaced CSV skips all of that safety entirely. The project currently uploads raw files, not using the workbook session API at all.

**How to avoid:**
Use the Microsoft Graph Excel workbook API with persistent sessions rather than replacing the raw file. Create a session with `POST /workbook/createSession` (`persistChanges: true`), send writes with the session ID header, then close the session. The API serializes concurrent writes and returns a 409 or merge conflict error instead of silently corrupting. If raw CSV is preferred for simplicity, implement an ETag-based read-before-write: fetch with `If-Match: {etag}`, and retry on 412 Precondition Failed. Never do a PUT without first confirming your read was the latest version.

**Warning signs:**
- Invoice records disappear from Excel after periods of simultaneous use by two+ users
- Row counts jump erratically
- The same maintenance record shows up twice with identical timestamps

**Phase to address:**
The phase that introduces Excel read/write for fleet data (unit list, invoice history, scheduled maintenance). Must be solved before any multi-user write path goes live.

---

### Pitfall 2: iOS Safari Evicts IndexedDB and Service Worker Cache After 7 Days of Inactivity

**What goes wrong:**
A fleet driver uses the app Monday, then doesn't open it for 8 days. When they return, Safari has cleared the service worker registration, the Cache API storage, and any IndexedDB data. The app behaves like a first-install: the offline shell may not load, cached unit lists are gone, and the user must be online to use the app at all. This is Apple's "Intelligent Tracking Prevention" storage cap — it applies to browser tabs but importantly does NOT apply to installed PWAs (Home Screen apps).

**Why it happens:**
Safari enforces a 7-day cap on script-writable storage for origins that haven't received user interaction. The eviction deletes all storage types simultaneously (IndexedDB + Cache API + service worker). The fix in iOS 17 only relaxed quota size; the eviction policy for browser tabs remains. The protection against eviction requires either: (a) the PWA is installed to the Home Screen, or (b) `StorageManager.persist()` is granted (granted automatically for Home Screen apps).

**How to avoid:**
Require users to install the PWA to the Home Screen (show an install banner with instructions). Once installed, iOS grants persistent storage automatically. For users who use it from Safari tab only: warn them their local data may be lost if they don't open the app weekly. Do NOT store critical fleet data (unit list, maintenance schedules) only in IndexedDB without a server-side copy — the Excel/OneDrive source of truth is the correct architecture here because it survives client eviction. Cache the app shell in service worker for offline loading, but treat local storage as a cache, not a database.

**Warning signs:**
- Users report "the app looks like it reset" or "my saved data is gone"
- Service worker not registered on app open (check `navigator.serviceWorker.ready` in app startup)
- App shell fails to load without network on first weekly visit

**Phase to address:**
PWA install/onboarding phase. The service worker cache strategy phase. Must be addressed before the app is distributed to the team.

---

### Pitfall 3: iOS Safari Camera Permission Re-Prompting in Standalone PWA Mode

**What goes wrong:**
User grants camera permission once, scans a document, navigates away, returns to the scanner — and iOS prompts for camera permission again. This is a known WebKit bug (Bug 215884) where standalone PWA mode re-prompts on navigation changes. Users deny the second prompt thinking something is wrong, and the scanner breaks for that session.

**Why it happens:**
Safari's permission persistence in standalone PWA mode is broken for `getUserMedia`. When the URL hash or navigation state changes, Safari treats it as a new permission decision context. The current app uses a camera file input (`<input type="file" accept="image/*" capture="environment">`) which avoids `getUserMedia` entirely — this is actually the safer path. If the app ever migrates to `getUserMedia` for live video preview, this bug will activate.

**How to avoid:**
Keep using `<input type="file" capture="environment">` for camera capture on iOS — it invokes the native camera UI and sidesteps `getUserMedia` permission bugs entirely. If live video preview is ever added, use `getUserMedia` only on Android and fall back to file input on iOS (detect via user-agent). Also ensure `playsinline` and `muted` attributes are set on any video element; without `playsinline`, iOS launches full-screen video instead of inline.

**Warning signs:**
- QA testing shows camera permission dialog appearing more than once per session on iOS
- Users report "camera keeps asking permission"
- Error in console: `NotAllowedError: The request is not allowed by the user agent`

**Phase to address:**
Any phase that modifies the camera/scanner flow. Must verify camera capture method before shipping iOS improvements.

---

### Pitfall 4: Canvas Memory Limit Crash on iOS (224 MB Total)

**What goes wrong:**
iOS Safari enforces a hard 224 MB total canvas memory limit. The current codebase processes images at 1200px max, creates multiple canvases (`work`, `output`, thumbnails), and never explicitly releases them. Processing 3-4 scans in a single session creates enough canvas memory to approach or exceed the limit, causing a JavaScript exception and a crash. On lower-end iPhones (older A-series chips, 2-3 GB RAM), the threshold is hit faster.

**Why it happens:**
`canvas.getContext('2d')` allocates GPU-backed memory. Setting canvas dimensions to 0 (`canvas.width = 0`) is the correct release mechanism, but the app never calls this after processing. `scanPages` holds live canvas references indefinitely. The perspective warp function allocates large typed arrays (`Float64Array`, `Uint8ClampedArray`) proportional to image dimensions that may not be immediately GC'd.

**How to avoid:**
- After adding a page to `scanPages`, convert the canvas to a compressed JPEG blob and store the blob instead of the canvas. Release the processing canvas immediately after (`canvas.width = 0; canvas.height = 0;`).
- Cap `scanPages` at 20 entries maximum.
- In `perspectiveWarp()`, release typed arrays after use by setting `srcData = null; outData = null;`.
- Process images in a Web Worker so OOM crashes don't kill the main thread UI.
- Add a guard: check `navigator.deviceMemory < 2` (where available) and reduce processing resolution on low-memory devices.

**Warning signs:**
- App crashes silently after scanning 3+ documents in one session on iOS
- Console shows: `Total canvas memory use exceeds the maximum limit`
- On older iPhones (iPhone 8, SE gen 1), crash happens at scan 2

**Phase to address:**
The image quality / scanner improvement phase. Must fix before shipping deskew or any resolution increase.

---

### Pitfall 5: Service Worker Cache Version Never Updates — Users Stuck on Old Code

**What goes wrong:**
A bug is fixed and deployed to GitHub Pages. The service worker still has `CACHE = 'camiora-v3'`. All users who loaded the app before the deploy continue to run the old cached version. Because `sw.js` itself may be cached, even reloading doesn't fetch the new service worker. Users running the old version file invoices against a broken naming scheme, or encounter a fixed bug that keeps hurting them.

**Why it happens:**
The service worker cache name is a static string. When code changes, the cache name doesn't change, so the old cache is served in perpetuity. The browser will re-fetch `sw.js` at most once per 24 hours (browser-enforced HTTP cache bypass for service workers), but only if `sw.js` itself has changed byte-for-byte. If the main app files changed but `sw.js` didn't, the old cache persists.

**How to avoid:**
Automate the cache version bump. Two viable approaches: (1) In a simple manual workflow, update the `CACHE` constant in `sw.js` as part of every deploy — name it with a date or sequential number (`camiora-2026-03-16`). (2) In a build process, generate the cache version from a file hash at build time. Also implement a "new version available" notification: listen for `controllerchange` on the service worker, prompt the user to reload. Add `skipWaiting()` in the new service worker's `install` handler so it activates immediately instead of waiting for all tabs to close.

**Warning signs:**
- Users describe seeing "old UI" after a deploy
- Deployed change not visible to users who used the app within the last 24 hours
- Developer sees the fix in their browser (cleared cache) but users do not

**Phase to address:**
Infrastructure / deployment hardening phase. Should be fixed before the app is distributed beyond the developer.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Raw file PUT to replace Excel/CSV | Simple, no session management needed | Silent data loss on concurrent writes; no atomicity | Only when a single user will ever write at a time |
| Synchronous image processing on main thread | Simple code, no worker setup | UI freezes 2-5s per scan on mobile; no cancel; OOM kills UI | Never for production mobile use |
| `sessionStorage` for OAuth token | Token clears on app close (slightly safer) | User must re-auth every session; kills offline capability | Only for highest-security contexts where persistence is explicitly unwanted |
| Static `CACHE` version string in service worker | Zero tooling required | Users never get updates reliably | Never; costs one line to fix |
| Monolithic `app.js` (909 lines) | Nothing to set up | Impossible to test; any change risks regressions; hard to onboard new devs | Only in the earliest throwaway prototype stage |
| Magic number thresholds in image processing | Fast to write | Cannot tune for different document types; opaque to future devs | Never; move to named config object even before shipping |
| No retry logic on Graph API calls | Simple code | One network hiccup = failed upload; bad on cellular | Never for the core upload path |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Microsoft Graph Excel API | Using raw file upload (PUT `/content`) for data updates instead of the workbook session API | Use `POST /workbook/createSession` + session ID header for all row writes; close session on completion |
| Microsoft Graph Excel API | Not handling `423 Locked` response (file open in another session) | Check for 423, wait and retry; show user "File is currently in use, retrying..." |
| Microsoft Graph OneDrive upload | Not reading `Retry-After` header on 429 responses | Parse `Retry-After` value (seconds), delay exactly that long before retry; do not exponential backoff independently |
| Microsoft Graph OneDrive upload | Assuming folder creation is synchronous and idempotent | `ensureFolder()` can return success but folder may not be immediately visible; add a brief wait or check before first upload to that folder |
| Microsoft Graph token refresh | Relying on token not expiring during a long scan session | Check token expiry before every API call; refresh silently if < 5 minutes remain; the current token is valid for ~1 hour but a user filling in details for 90 minutes will hit expiry mid-upload |
| iOS file input | Using `getUserMedia` for live scanner preview | Use `<input type="file" accept="image/*" capture="environment">` on iOS; avoids recurring permission prompt bug; falls back to native camera UI |
| jsPDF from CDN | Relying on CDN availability in the field | Host jsPDF locally or bundle it; CDN failure = PDF generation fully broken with no fallback |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Image processing on main thread | UI freezes 2-5s during scan; scroll and tap unresponsive; on slow devices, "page unresponsive" dialog | Move all canvas processing to a Web Worker; post `ImageData` to worker, receive result back | Every scan on mobile; immediately |
| Unreleased canvas accumulation | App slows after 3+ scans; crash with "canvas memory exceeded" on iOS | Convert processed canvas to JPEG blob immediately; call `canvas.width = 0` to release; store blobs not canvases in `scanPages` | iOS at ~3-5 high-res scans; Android at ~10-15 |
| Full-resolution processing (1200px) | Gaussian blur takes 3s on a 1200x1600 image (48M operations) | Downsample to 600px for processing; upscale output only for final PDF; run Gaussian blur at half res | Every scan; processing time scales quadratically with resolution |
| PDF built entirely in memory | 50+ MB RAM for multi-page PDF; browser crash on low-memory iPhones | Process and serialize one page at a time; limit max pages to 20; use IndexedDB as intermediate storage | Multi-page documents on iPhone SE / iPhone 8 (2 GB RAM devices) |
| No rate limit handling on Graph API | Uploads randomly fail with HTTP 429 when multiple team members use app simultaneously | Implement Retry-After-aware retry: read `Retry-After` header, delay exactly that long, retry up to 3 times | Small team: rarely; under any concurrent load burst |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| OAuth token in `sessionStorage` | Any XSS vulnerability can steal the token; `sessionStorage` is accessible to all scripts on the page | Store in memory only (module-scoped variable) for security-critical contexts; if persistence needed, use `localStorage` with a clearly documented trade-off |
| Path construction from user-supplied unit type/number | If select validation is bypassed (e.g., via DevTools), `../` traversal could write to unintended OneDrive folders | Server-side would sanitize this; on client-side: whitelist validation before path construction — only allow `[A-Za-z0-9-_]`, max 20 chars, no slashes |
| jsPDF loaded from external CDN without SRI | Compromised CDN could inject malicious code into PDF generation | Add Subresource Integrity hash to the CDN script tag, or self-host the library |
| No `Content-Security-Policy` header | Inline script injection possible if any XSS vector exists | GitHub Pages doesn't support custom response headers natively; mitigate with `<meta http-equiv="Content-Security-Policy">` tag restricting `script-src` to `'self'` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent upload failure with no retry | User fills out form, upload fails on cellular hiccup, all data is lost, user must start over | Keep form data and scanned pages in memory on failure; show "Retry" button; never clear on first failure |
| No file name preview before upload | User uploads 10 invoices and discovers the name template was wrong; must rename 10 files in OneDrive manually | Show the final filename and target folder path before the upload button is clickable |
| Token expiry mid-session | User spends 90 minutes filling in maintenance data, clicks upload, gets "Upload failed" — session expired silently | Proactively refresh token when < 5 minutes remain; show "Session expiring" warning at 55 minutes |
| Black corners on perspective-warped output | Invoice looks professional in preview but the corners of the actual PDF have black triangles; looks broken | Fill out-of-bounds pixels with the nearest edge color (extend edges), not transparent/black |
| Camera file input not reset after cancellation | User taps scan, takes a bad photo, cancels, taps scan again — old photo appears instantly with no chance to reshoot | Reset `cameraInput.value = ''` in `removeScanPage()` handler; or better: replace the input element entirely to force a fresh file dialog |
| App requires online connection every launch | Fleet field workers in shop areas with poor cellular cannot use the app to review maintenance history | Cache unit list and maintenance data in IndexedDB at first load; allow read-only offline access; queue writes for when connection returns |

---

## "Looks Done But Isn't" Checklist

- [ ] **Excel write path:** Appears to write data successfully in solo testing — verify with two simultaneous writes from different devices; check for row corruption or missing entries.
- [ ] **Offline mode:** App shell loads without network — verify unit list, maintenance history, and scheduled maintenance are readable offline (not just the HTML shell).
- [ ] **iOS camera on Home Screen PWA:** Camera works in browser tab — verify it also works after "Add to Home Screen" install; these are different permission contexts.
- [ ] **Service worker update:** New deploy is visible to developer — verify users who had the app open yesterday see the new version without a manual cache clear.
- [ ] **Token refresh:** Upload works in a 5-minute test session — verify upload works after 65 minutes of continuous app use (token expires at 60 minutes by default).
- [ ] **Memory under repeated scanning:** First scan works — verify 5 consecutive scans in one session don't crash the app on an iPhone (check for the 224 MB canvas memory error).
- [ ] **OneDrive folder creation on slow network:** Folder creates and upload succeeds on WiFi — verify on a throttled 3G connection where folder creation takes 3-4 seconds.
- [ ] **jsPDF fallback:** PDF generation works when CDN is reachable — verify app behavior when CDN is blocked (corporate firewall, offline); there should be a graceful error, not a silent hang.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Excel row overwritten by concurrent write | HIGH | Manually recover from OneDrive version history (OneDrive keeps 30 days of file versions); identify timestamp of corruption; restore previous version; re-enter lost data |
| iOS cleared all PWA storage | LOW | Data lives in OneDrive/Excel (source of truth); re-open app online, re-authenticate, data re-loads from source |
| Service worker stuck on old version | LOW | User: Settings > Safari > Clear History and Website Data, or "Delete" and re-add the Home Screen app; Developer: increment CACHE name and redeploy |
| Canvas OOM crash on iOS | LOW | User must reload the app (all unsaved scan pages are lost); Prevention is the only real answer here |
| Token expired mid-upload | LOW | User re-authenticates (PKCE flow, takes ~10 seconds); upload data should be preserved if form was not cleared on failure |
| Graph API 429 throttling | LOW | Retry-After header specifies exact wait time; implement retry with that delay; no data is lost, just delayed |
| jsPDF CDN unavailable | MEDIUM | PDF generation is completely broken until CDN recovers; mitigation: self-host the library so CDN goes offline without app impact |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Excel concurrent write corruption | Excel/OneDrive data layer phase (when row writes are built) | Test: Two devices submit simultaneously; confirm both rows appear with correct data |
| iOS 7-day storage eviction | PWA install/onboarding phase | Test: Use app from Safari tab; don't open for 8 days; verify graceful recovery, not crash |
| iOS camera permission re-prompting | Scanner/camera flow phase | Test: Scan, navigate away, return to scanner on iOS Home Screen app; camera must not re-prompt |
| Canvas memory crash (224 MB) | Image quality improvement phase (deskew/B&W) | Test: Scan 5 documents consecutively on an iPhone SE or iPhone 8; verify no crash |
| Service worker cache staleness | Deployment/infrastructure phase | Test: Deploy change; reload without clearing cache; verify new version visible within 1 page reload |
| Token expiry mid-session | Auth hardening phase | Test: Authenticate, wait 61 minutes without uploading, attempt upload; verify auto-refresh not failure |
| No retry on upload failure | Upload reliability phase | Test: Throttle network to 2G mid-upload; verify retry occurs and upload eventually succeeds |
| Silent generic error messages | Error handling / UX phase | Test: Revoke OneDrive permission mid-session; verify error message names the actual problem |
| Main thread image processing freeze | Performance phase | Test: Scan a document and interact with UI during processing; UI must remain responsive |

---

## Sources

- [Microsoft Graph: Best practices for working with the Excel API](https://learn.microsoft.com/en-us/graph/workbook-best-practice) — HIGH confidence (official Microsoft docs, updated 2025-08-06)
- [Microsoft Graph: Throttling guidance](https://learn.microsoft.com/en-us/graph/throttling) — HIGH confidence (official Microsoft docs)
- [Microsoft Graph: Service-specific throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits) — HIGH confidence (official Microsoft docs)
- [WebKit: Updates to Storage Policy (iOS 17 storage changes)](https://webkit.org/blog/14403/updates-to-storage-policy/) — HIGH confidence (official Apple/WebKit engineering blog)
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) — HIGH confidence (MDN official reference)
- [WebKit Bug 215884: getUserMedia recurring permission prompts in standalone PWA](https://bugs.webkit.org/show_bug.cgi?id=215884) — HIGH confidence (official WebKit bug tracker)
- [Apple Developer Forums: iOS Total canvas memory use exceeds the maximum limit](https://developer.apple.com/forums/thread/687866) — MEDIUM confidence (official Apple developer forums, community-verified)
- [PWA on iOS limitations — brainhub.eu](https://brainhub.eu/library/pwa-on-ios) — MEDIUM confidence (WebSearch, multiple sources corroborate)
- [iOS PWA 7-day storage limit — Apple Developer Forums](https://developer.apple.com/forums/thread/710157) — HIGH confidence (official Apple forums corroborated by WebKit source)
- Existing codebase analysis: `.planning/codebase/CONCERNS.md` — HIGH confidence (direct codebase audit)

---
*Pitfalls research for: fleet maintenance PWA (Excel/OneDrive database, client-side image processing, iOS/Android mobile)*
*Researched: 2026-03-16*

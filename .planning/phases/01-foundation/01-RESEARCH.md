# Phase 1: Foundation - Research

**Researched:** 2026-03-16
**Domain:** ES module refactor (brownfield vanilla JS monolith) + CSV/OneDrive data layer + hash router
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-04 | ES module refactor of existing monolith `app.js` | Module split pattern documented; brownfield migration path confirmed via MDN ES modules guide |
| FLEET-01 | Unit roster loaded from CSV on OneDrive (trucks and trailers) | Graph API file download endpoint pattern confirmed; CSV parse strategy documented; OneDrive folder structure decided |
| FLEET-07 | CSV optimistic locking (hash-check before write, diff-merge changes) | SubtleCrypto SHA-256 hashing already in codebase for PKCE; GET-hash-PUT pattern is standard read-modify-write; no new dependencies required |
</phase_requirements>

---

## Summary

Phase 1 performs two tightly linked operations: splitting the 910-line `app.js` monolith into ES modules, and establishing the CSV data layer that every subsequent feature depends on. These are done together because the CSV module (`app/graph/csv.js`) is the first extraction — it becomes the model all other modules follow.

The existing codebase is brownfield vanilla JS with no build step, CDN-only dependencies, and working PKCE auth and PDF upload. The module split is purely structural: logic moves, APIs stay the same. No library additions are required for Phase 1. The CSV layer uses the same `fetch` + Bearer token pattern already in `app.js` for file upload — the only new operation is a GET to download file content, plus SubtleCrypto hashing (already in codebase for PKCE).

The hash-based router is straightforward: `window.location.hash` + `hashchange` event. The only view in Phase 1 is the existing upload form, migrated as-is to `app/views/upload.js`. The router's job is to render it correctly and set up the `#upload` default.

**Primary recommendation:** Migrate incrementally — extract auth first (it has no dependencies), then the CSV layer, then state + cache, then router, then the upload view. Keep `app.js` as a thin coordinator until each module is ready, then delete it. The `index.html` swap from `<script src="app.js">` to `<script type="module" src="app/main.js">` is the final cutover.

---

## Standard Stack

### Core (no additions needed for Phase 1)

| Technology | Version | Purpose | Why Standard |
|------------|---------|---------|--------------|
| Native ES Modules | Browser built-in | Split monolith without build step | `<script type="module">` supported in all modern browsers; GitHub Pages serves `.js` directly; zero tooling overhead |
| Microsoft Graph API v1.0 | Existing | CSV file download and upload | Same endpoints already used for PDF upload; `GET /me/drive/root:/{path}:/content` downloads any file as raw bytes/text |
| SubtleCrypto | Browser built-in | SHA-256 hash of CSV content for optimistic lock | Already in codebase for PKCE challenge generation; no new capability needed |
| IndexedDB | Browser built-in | Snapshot cache of CSV data for offline reads | Standard PWA offline storage; `idb` wrapper pattern is 3 lines of code at this scale |

### What NOT to Add in Phase 1

| Library | Why to Skip | When It Matters |
|---------|------------|-----------------|
| SheetJS | CSV is parsed with `String.split` — no Excel parser needed | Only needed if the data layer switches to `.xlsx` |
| MSAL.js | PKCE auth already works; token refresh is Phase 6 scope | Phase 6 only |
| Any npm package | No build step; CDN-only constraint; Phase 1 adds zero new CDN scripts | Stays CDN-only through Phase 1 |

---

## Architecture Patterns

### Recommended Module Structure (Phase 1 target state)

```
camiora-pwa/
├── index.html              # CHANGED: loads app/main.js as <script type="module">
├── style.css               # UNCHANGED
├── sw.js                   # CHANGED: STATIC list updated to include app/*.js files
├── manifest.json           # UNCHANGED
├── app.js                  # DELETED after cutover (or kept empty for safety)
│
└── app/
    ├── main.js             # Boot: auth check, sw registration, router init, CSV load
    ├── state.js            # Shared in-memory singleton: token, fleet, activeUnitId, etc.
    ├── router.js           # Hash router: #upload default, hashchange handler
    │
    ├── views/
    │   └── upload.js       # Existing upload form UI — migrated from renderApp(), NOT rewritten
    │
    ├── graph/
    │   ├── auth.js         # PKCE functions extracted from app.js (lines 20-97)
    │   ├── csv.js          # NEW: CSV download, parse, optimistic-lock write
    │   └── files.js        # ensureFolder + uploadFile extracted from app.js (lines 801-835)
    │
    └── storage/
        └── cache.js        # IndexedDB read/write for fleet CSV snapshot
```

**What is NOT created in Phase 1** (out of scope):
- `app/views/dashboard.js` — Phase 5
- `app/views/unit-detail.js` — Phase 4
- `app/imaging/` — Phase 2
- `app/graph/api.js` (shared retry wrapper) — can be added here if desired, but not required

### Pattern 1: ES Module Brownfield Migration (Incremental Cutover)

**What:** Extract one module at a time. During migration, `app.js` calls into the new modules using dynamic `import()` or by converting to a module itself early. The final step is the `index.html` script tag swap.

**When to use:** Any monolith extraction where the existing app must remain functional throughout.

**Migration sequence:**
```
Step 1: Convert app.js itself to a module
  index.html: <script type="module" src="app.js">
  Verify: app still works (ES module mode catches strict-mode errors early)

Step 2: Extract app/graph/auth.js
  Move: generateRandomString, generatePKCE, startLogin, exchangeCodeForToken,
        saveToken, loadToken, signOut
  app.js: import * from './app/graph/auth.js'

Step 3: Extract app/graph/files.js
  Move: ensureFolder, uploadFile
  app.js: import * from './app/graph/files.js'

Step 4: Create app/graph/csv.js (NEW logic)
  Implement: downloadCSV, parseCSV, hashContent, writeCSV (with lock)

Step 5: Create app/state.js + app/storage/cache.js
  state.js: in-memory singleton
  cache.js: IndexedDB snapshot

Step 6: Extract app/views/upload.js
  Move: renderApp, renderAuth, renderFileList, updateAll, getBaseName,
        getServiceLabel, handleFiles, removeFile, handleSubmit,
        handleCameraCapture, buildPdfFromPages (scanning functions)

Step 7: Create app/router.js
  Implement: initRouter with #upload default

Step 8: Create app/main.js
  Boot sequence: sw register, auth check, router init, loadFleet

Step 9: index.html cutover
  Change: <script src="app.js"> -> <script type="module" src="app/main.js">
  Delete: app.js (or empty it)
```

### Pattern 2: Hash Router

**What:** `window.location.hash` drives view. Router listens to `hashchange` and initial load. Each view exports `render(container, state)`.

**When to use:** Static host (GitHub Pages) — no server-side routing. Internal tool — hash URLs are fine.

```javascript
// app/router.js
import { render as renderUpload } from './views/upload.js';

const ROUTES = {
  '#upload': renderUpload,
};

export function initRouter(container, state) {
  const go = () => {
    const hash = window.location.hash || '#upload';
    const key  = hash.split('?')[0];
    const fn   = ROUTES[key] || renderUpload;
    container.innerHTML = '';
    fn(container, state);
  };
  window.addEventListener('hashchange', go);
  go();
}
```

**Phase 1 scope:** Only `#upload` route exists. Router infrastructure is built so Phase 2+ can add routes by importing new view modules.

### Pattern 3: CSV Layer with Optimistic Locking

**What:** Download CSV as text, hash it, parse it, use it in memory. Before writing back, re-download and re-hash. If hashes match, write. If not, handle conflict.

**Graph API endpoints used:**
```
GET  /me/drive/root:/{path}:/content           — download CSV as text (same pattern as PDF upload in reverse)
PUT  /me/drive/root:/{path}:/content           — write CSV text back
GET  /me/drive/root:/{path}                    — get file metadata (driveItem ID, for caching)
```

**Full CSV layer pattern:**
```javascript
// app/graph/csv.js
const GRAPH = 'https://graph.microsoft.com/v1.0';

async function graphGet(path, token) {
  const resp = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Graph GET ${path} failed: ${resp.status}`);
  return resp;
}

async function hashText(text) {
  const buf  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function downloadCSV(remotePath, token) {
  const resp = await graphGet(`/me/drive/root:/${encodeURIComponent(remotePath)}:/content`, token);
  const text = await resp.text();
  const hash = await hashText(text);
  return { text, hash };
}

export function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const [header, ...rows] = lines;
  const cols = header.split(',').map(c => c.trim());
  return rows.map(row => {
    const vals = row.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, (vals[i] || '').trim()]));
  });
}

export function serializeCSV(headers, rows) {
  const headerLine = headers.join(',');
  const rowLines   = rows.map(r => headers.map(h => r[h] ?? '').join(','));
  return [headerLine, ...rowLines].join('\n');
}

export async function writeCSVWithLock(remotePath, originalHash, newText, token) {
  // Re-download to check for concurrent edits
  const { text: currentText, hash: currentHash } = await downloadCSV(remotePath, token);

  if (currentHash !== originalHash) {
    // Conflict detected — Phase 1: surface to caller; Phase 3+ can add merge logic
    throw new Error('CSV_CONFLICT');
  }

  const url  = `${GRAPH}/me/drive/root:/${encodeURIComponent(remotePath)}:/content`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'text/csv',
    },
    body: newText,
  });
  if (!resp.ok) throw new Error(`CSV write failed: ${resp.status}`);
  return resp.json(); // returns updated driveItem
}
```

**Source:** Same `PUT /me/drive/root:/{path}:/content` pattern used in existing `uploadFile()` (app.js line 823-835). SubtleCrypto digest already in codebase (app.js line 29). HIGH confidence.

### Pattern 4: State Singleton

**What:** Single in-memory object, imported by all modules. Views read from it; action functions mutate it then re-render.

```javascript
// app/state.js
export const state = {
  token:        null,   // OAuth access token string
  tokenExp:     0,      // expiry timestamp ms
  fleet: {
    units:      [],     // parsed rows from units.csv
    unitsHash:  null,   // SHA-256 of last-read units.csv (for optimistic lock)
    unitsPath:  null,   // OneDrive path to units.csv (set once, from config)
  },
  scanPages:    [],     // canvas/blob array for current scan session
  activeUnitId: null,   // for unit detail view (Phase 4)
  isUploading:  false,
};
```

**Why singleton (not class instances):** Vanilla JS with no framework. A plain exported object is importable by any module, mutatable in place, and requires no subscription mechanism for Phase 1. A reactive store is not needed at this scale.

### Pattern 5: IndexedDB Cache (read-cache-then-freshen)

**What:** On boot, read IndexedDB immediately (zero latency). Then fetch fresh CSV in background. On fresh data arrival, update `state.fleet` and re-render.

```javascript
// app/storage/cache.js
const DB_NAME    = 'camiora';
const STORE_NAME = 'fleet';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function getCachedFleet() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('units');
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror   = () => resolve(null);
  });
}

export async function setCachedFleet(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(data, 'units');
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}
```

**Boot sequence using the cache:**
```javascript
// in app/main.js
async function loadFleetData(state, container) {
  // Serve cached data immediately (offline-safe, instant)
  const cached = await getCachedFleet();
  if (cached) {
    state.fleet.units     = cached.units;
    state.fleet.unitsHash = cached.hash;
    renderActiveView(container, state);
  }

  // Freshen in background
  try {
    const { text, hash } = await downloadCSV(state.fleet.unitsPath, state.token);
    const units = parseCSV(text);
    state.fleet.units     = units;
    state.fleet.unitsHash = hash;
    await setCachedFleet({ units, hash });
    renderActiveView(container, state);
  } catch (err) {
    if (!cached) showToast('Could not load fleet data — check connection', 'error');
    // If cached was served, silently fail the background refresh
  }
}
```

### Pattern 6: CSV Schema (units.csv)

**Decision to lock before implementation:** The units CSV schema must be finalized before writing the parser. Based on the existing form fields in `app.js` and the SUMMARY.md recommendation:

```csv
UnitId,Type,Number,Make,Model,Year,Status
TRK-001,Truck,001,Freightliner,Cascadia,2019,active
TRK-042,Truck,042,Kenworth,T680,2021,active
TRL-017,Trailer,017,Wabash,53ft,2020,active
```

| Column | Purpose | Notes |
|--------|---------|-------|
| `UnitId` | Primary key, used in folder paths and filenames | Format: `TRK-###` or `TRL-###` |
| `Type` | `Truck` or `Trailer` | Matches existing form `unitType` dropdown values |
| `Number` | Zero-padded 3-digit number string | `001`–`999` |
| `Make` | Manufacturer | e.g., Freightliner, Kenworth |
| `Model` | Model name | e.g., Cascadia, T680 |
| `Year` | 4-digit year | |
| `Status` | `active` or `inactive` | Filter for dropdown population |

**The CSV file lives at:** `Fleet Maintenance/data/units.csv` on OneDrive.

This path must be hardcoded in config (or stored in IndexedDB after first discovery). For Phase 1, hardcode in `state.js`:
```javascript
fleet: {
  unitsPath: 'Fleet Maintenance/data/units.csv',
  ...
}
```

### Anti-Patterns to Avoid

- **Growing app.js further:** Do not add any Phase 1 logic to `app.js`. All new code goes in `app/` modules; extraction pulls from `app.js`.
- **Calling fetch in view modules:** Views must only read `state.*`. All Graph API calls go through `app/graph/` modules.
- **Parsing CSV in views:** CSV parsing belongs in `csv.js`. Views receive `state.fleet.units[]` — an array of plain objects.
- **Writing to CSV without the lock:** Every CSV PUT must go through `writeCSVWithLock`. Never call the raw PUT endpoint directly.
- **Storing CSV file content in IndexedDB:** Store the *parsed* array + the hash string. Storing raw CSV text wastes space and re-parses on every read.
- **`window.*` function assignments in ES modules:** The existing `app.js` uses `onclick="startLogin()"` which expects global functions. When migrating to ES modules, these `window.*` assignments break. Either convert all inline handlers to `addEventListener` or explicitly assign `window.startLogin = startLogin` during the migration. The cleanest path is `addEventListener` in the view module.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 hash of CSV text | Custom hash function | `crypto.subtle.digest('SHA-256', ...)` | Already in codebase (PKCE); zero-dependency; available in all target browsers |
| CSV serialization | Custom serializer with edge cases | Simple `headers.map()` join | Units CSV has no commas in field values (unit IDs, make/model, numeric fields); hand-rolling quoting logic for Phase 1 is premature |
| IndexedDB wrapper | Full reactive store (idb-keyval, etc.) | 3-function bare IndexedDB wrapper | The cache is read/write for one key (`units`); no library overhead warranted at this scale |
| Hash router | Framework router (page.js, navigo) | 15-line `hashchange` listener | Single-level hash routing; no params needed in Phase 1; frameworks add CDN script tags |

**Key insight:** Phase 1 adds zero new CDN dependencies. Every capability needed is either already in the browser or already in the codebase.

---

## Common Pitfalls

### Pitfall 1: `window.X` global functions break in ES modules
**What goes wrong:** The existing `app.js` uses inline `onclick="startLogin()"`, `onclick="removeFile(i)"`, etc. When the code moves to an ES module, these functions are no longer on `window` — the browser throws `ReferenceError: startLogin is not defined` at click time.
**Why it happens:** ES modules execute in strict mode and do not pollute the global scope by design.
**How to avoid:** During view extraction, convert all `onclick="fn()"` attributes to `addEventListener` calls added after `innerHTML` assignment. Or, as a migration bridge, explicitly assign `window.fn = fn` in the module. The full fix (addEventListener) is cleaner and should be the target.
**Warning signs:** Console shows `ReferenceError` on button clicks immediately after switching to `type="module"`.

### Pitfall 2: CORS / MIME type errors with ES module imports on file:// protocol
**What goes wrong:** Local development via `file://` path causes `CORS error` or `Failed to load module script: MIME type mismatch` when using ES module imports.
**Why it happens:** Browsers enforce CORS on `import` statements; `file://` lacks a proper origin.
**How to avoid:** Always test via a local HTTP server (`python -m http.server 8080` or VS Code Live Server). This is already the pattern for PKCE auth (redirect URIs require HTTP anyway).
**Warning signs:** Module imports work on GitHub Pages but throw CORS errors locally.

### Pitfall 3: Service worker caches old `app.js` after cutover
**What goes wrong:** After switching `index.html` to load `app/main.js`, users with the old service worker cached still get the old `app.js` + old `index.html` for up to weeks.
**Why it happens:** `sw.js` cache version `camiora-v3` is still in place; the `STATIC` array still lists `./app.js`; users don't get the update.
**How to avoid:** In the same commit that adds `app/main.js` and changes `index.html`: (1) update the `CACHE` constant to `camiora-v4` (or use a date string), (2) update `STATIC` to list `./app/main.js`, `./app/graph/auth.js`, etc. The existing `skipWaiting()` in `sw.js` already handles forced activation — just bump the cache key.
**Warning signs:** App still shows old behavior after deploy; DevTools shows old `app.js` in cache.

### Pitfall 4: CSV path not found on first load (file doesn't exist yet)
**What goes wrong:** `downloadCSV('Fleet Maintenance/data/units.csv', token)` returns 404 because the CSV file hasn't been created on OneDrive yet.
**Why it happens:** The CSV files are part of the data layer, not the app bundle. A fresh deployment has no CSV file until someone creates it.
**How to avoid:** Handle the 404 gracefully: catch the error, set `state.fleet.units = []`, show a "Fleet data not set up yet — contact your admin" message instead of crashing. In the upload form, the unit roster dropdown simply shows empty with a placeholder. Phase 3 will include admin tooling to create the initial CSV.
**Warning signs:** Uncaught rejection from `downloadCSV` on first run of a new deployment.

### Pitfall 5: `encodeURIComponent` breaks OneDrive path resolution for nested paths
**What goes wrong:** Calling `encodeURIComponent('Fleet Maintenance/data/units.csv')` produces `Fleet%20Maintenance%2Fdata%2Funits.csv` — encoding the slashes — which the Graph API interprets as a filename, not a path. Returns 404.
**Why it happens:** `encodeURIComponent` encodes `/` as `%2F`. OneDrive path segments use `/` as delimiter.
**How to avoid:** Encode path *segments* individually, not the whole path:
```javascript
const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
const url = `${GRAPH}/me/drive/root:/${encodedPath}:/content`;
```
**Warning signs:** Graph API returns 404 for paths containing spaces, even though the folder exists.

### Pitfall 6: CSV hash mismatch on trailing newline differences
**What goes wrong:** Two reads of the same file produce different hashes because the file has a trailing newline on one read but not another, or Windows vs. Unix line endings differ.
**Why it happens:** OneDrive file download returns the raw bytes as stored. If the previous PUT wrote `\n`-terminated lines but a new write produces `\r\n`, the hash changes even with no data change.
**How to avoid:** Normalize line endings to `\n` immediately after download, before hashing:
```javascript
const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const hash = await hashText(normalized);
```
Apply the same normalization before every write. Always write with `\n` line endings.
**Warning signs:** Optimistic lock triggers `CSV_CONFLICT` even when no other user has touched the file.

---

## Code Examples

### Download and parse units.csv

```javascript
// Source: existing uploadFile() in app.js (lines 823-835) — same PUT pattern reversed for GET
const GRAPH = 'https://graph.microsoft.com/v1.0';

async function downloadCSV(remotePath, token) {
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const resp = await fetch(`${GRAPH}/me/drive/root:/${encodedPath}:/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (resp.status === 404) return { text: null, hash: null };
  if (!resp.ok) throw new Error(`CSV download failed: ${resp.status}`);
  const raw  = await resp.text();
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const hash = await hashText(text);
  return { text, hash };
}
```

### Hash CSV content

```javascript
// Source: existing generatePKCE() in app.js (lines 26-33) — same SubtleCrypto pattern
async function hashText(text) {
  const buf  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### Parse CSV to array of objects

```javascript
// Source: standard pattern; no library needed for flat CSV with no embedded commas
export function parseCSV(text) {
  if (!text) return [];
  const lines = text.trim().split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];                    // header-only or empty
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
  });
}
```

### Write CSV back with optimistic lock

```javascript
// Source: PUT pattern from uploadFile() app.js line 823; re-download before write
export async function writeCSVWithLock(remotePath, originalHash, newCSVText, token) {
  const { text: currentText, hash: currentHash } = await downloadCSV(remotePath, token);
  if (currentHash !== originalHash) {
    const err = new Error('CSV has been modified by another session');
    err.code  = 'CSV_CONFLICT';
    throw err;
  }
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const resp = await fetch(`${GRAPH}/me/drive/root:/${encodedPath}:/content`, {
    method: 'PUT',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: newCSVText,
  });
  if (!resp.ok) throw new Error(`CSV write failed: ${resp.status}`);
  return resp.json();
}
```

### index.html after cutover

```html
<!-- BEFORE -->
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script src="app.js"></script>
</body>

<!-- AFTER (Phase 1 cutover) -->
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app/main.js"></script>
</body>
```

Note: jsPDF CDN tag stays as-is for Phase 1. The upgrade to 4.2.0 is Phase 2 scope (scanner polish).

### sw.js STATIC list update

```javascript
// BEFORE
const CACHE  = 'camiora-v3';
const STATIC = ['./', './index.html', './app.js', './style.css', './manifest.json', ...];

// AFTER (Phase 1 cutover — update in same commit as index.html change)
const CACHE  = 'camiora-v4';
const STATIC = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './app/main.js',
  './app/state.js',
  './app/router.js',
  './app/views/upload.js',
  './app/graph/auth.js',
  './app/graph/csv.js',
  './app/graph/files.js',
  './app/storage/cache.js',
];
```

---

## State of the Art

| Old Approach | Current Approach | Impact on Phase 1 |
|--------------|------------------|-------------------|
| Single `app.js` monolith | ES module split with native `<script type="module">` | The migration target for INFRA-04 |
| Global variables (`accessToken`, `files`, `scanPages`) | `state.js` singleton exported object | State lives in module, not on `window`; prevents accidental mutation from inline handlers |
| Excel API sessions (`withSession`, `workbook-session-id`) | CSV GET/PUT via Graph Files API | Eliminated entirely; no sessions, no `423 Locked`, no session expiry |
| SheetJS recommended in earlier research | Plain `String.split` CSV parsing | Correct for this data model; no dependency added |
| `onclick="fn()"` inline handlers (relies on global scope) | `addEventListener` in view module | Required in ES module context; migration step in upload.js extraction |

---

## Open Questions

1. **units.csv initial file creation**
   - What we know: The CSV must exist at `Fleet Maintenance/data/units.csv` before `downloadCSV` runs
   - What's unclear: Who creates the file and populates it with the existing fleet data?
   - Recommendation: Handle 404 gracefully in `downloadCSV` (return empty array, not an error). Add a note to deployment instructions that the CSV must be created manually before first use. Phase 1 does not need a CSV creation UI.

2. **OneDrive folder path configuration**
   - What we know: Current code hardcodes `'Fleet Maintenance'` in `CONFIG.ONEDRIVE_BASE`
   - What's unclear: Should the CSV subfolder path (`Fleet Maintenance/data/`) be in `state.js` config or read from a config file?
   - Recommendation: Hardcode `Fleet Maintenance/data/units.csv` in `state.js` for Phase 1. Moving to a config file is Phase 6 hardening scope.

3. **Units.csv field delimiter safety**
   - What we know: Make/model names like `Freightliner Cascadia` contain spaces but not commas
   - What's unclear: Can any field contain a comma? (e.g. custom unit descriptions)
   - Recommendation: For Phase 1, assume no commas in field values. The simple `split(',')` parser handles the defined schema. If future fields need commas, switch to a quoted-field CSV parser at that point.

---

## Validation Architecture

`nyquist_validation` is enabled in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no test files, no test runner config |
| Config file | None (Wave 0 must create) |
| Quick run command | `node --test app/graph/csv.test.js` (Node.js built-in test runner, no install) |
| Full suite command | `node --test app/**/*.test.js` |

**Rationale for Node built-in test runner:** No npm, no build step, no `package.json`. Node 18+ `--test` runner requires zero setup. Tests for CSV parsing and hashing are pure functions — no DOM needed. Tests for router and view modules can be skipped (manual-only) in Phase 1 since they require browser APIs.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLEET-01 | `parseCSV` returns correct array of objects from CSV text | unit | `node --test app/graph/csv.test.js` | Wave 0 |
| FLEET-01 | `downloadCSV` handles 404 gracefully (returns null, no throw) | unit (mock fetch) | `node --test app/graph/csv.test.js` | Wave 0 |
| FLEET-07 | `writeCSVWithLock` throws `CSV_CONFLICT` when hash differs | unit (mock fetch) | `node --test app/graph/csv.test.js` | Wave 0 |
| FLEET-07 | `hashText` produces consistent hash for same input | unit | `node --test app/graph/csv.test.js` | Wave 0 |
| FLEET-07 | `hashText` produces different hash after content change | unit | `node --test app/graph/csv.test.js` | Wave 0 |
| INFRA-04 | App loads from `app/main.js` with no JS errors | smoke | Manual: open browser, check DevTools console | Manual only |
| INFRA-04 | `#upload` hash route renders upload form | smoke | Manual: navigate to `/#upload`, verify form visible | Manual only |
| FLEET-01 | Unit roster dropdown populates from `state.fleet.units` after load | smoke | Manual: load app, verify dropdown has units | Manual only |

### Sampling Rate

- **Per task commit:** `node --test app/graph/csv.test.js` (covers FLEET-01 + FLEET-07 pure logic)
- **Per wave merge:** `node --test app/graph/csv.test.js` + manual smoke: load app, check console, verify upload route
- **Phase gate:** All automated tests green + manual smoke checklist passes before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `app/graph/csv.test.js` — covers FLEET-01 (parse, 404 handling) and FLEET-07 (hash consistency, lock conflict)
- [ ] No test runner install needed — `node --test` is built-in to Node 18+

---

## Sources

### Primary (HIGH confidence)

- Existing `app.js` (lines 26-33) — SubtleCrypto SHA-256 pattern already in codebase; hash reuse confirmed
- Existing `app.js` (lines 823-835) — `uploadFile` PUT pattern; same endpoint reversed for GET download
- Existing `app.js` (lines 100-118) — boot/auth sequence to preserve during migration
- [MDN: JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — `<script type="module">`, strict mode, no global scope pollution
- [Microsoft Graph: Drive Item Content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content) — `GET /me/drive/root:/{path}:/content` returns raw file bytes
- `.planning/research/SUMMARY.md` — CSV data layer pattern documented; decision confirmed

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` — router pattern, state singleton, component boundaries; patterns verified against MDN
- `.planning/codebase/ARCHITECTURE.md` — full layer analysis of existing app.js; used to determine extraction sequence

### Tertiary (LOW confidence)

- None — all claims in this document are backed by existing codebase or official sources.

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Zero new dependencies; all patterns use existing browser APIs or existing codebase patterns |
| Architecture | HIGH | Module structure follows MDN ES module guidance; component boundaries derived from existing layer analysis |
| CSV layer | HIGH | GET/PUT endpoints same as existing PDF upload; SubtleCrypto hash same as existing PKCE code |
| Router | HIGH | `hashchange` + `window.location.hash` is standard; confirmed via MDN History API docs |
| Pitfalls | HIGH | `window.X` global scope issue is a documented ES module behavior; encoding/CRLF issues verified against existing OneDrive upload code patterns |
| Test approach | MEDIUM | Node built-in `--test` runner verified available in Node 18+; exact mock-fetch approach for unit tests is conventional but not confirmed against a specific source |

**Research date:** 2026-03-16
**Valid until:** 2026-06-16 (stable APIs — Graph, SubtleCrypto, ES modules are long-lived specs)

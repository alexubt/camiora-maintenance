# Architecture Research

**Domain:** No-backend PWA with OneDrive/Excel as database, client-side image processing, multi-view dashboard
**Researched:** 2026-03-16
**Confidence:** HIGH (Microsoft Graph API patterns from official docs; ES module patterns from MDN/modern-web.dev)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client Only)                      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    View Layer (Router)                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │  Upload  │  │Dashboard │  │  Unit    │  │  Scanner │  │  │
│  │  │   View   │  │  View    │  │  Detail  │  │   View   │  │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │  │
│  └───────┼─────────────┼─────────────┼──────────────┼────────┘  │
│          │             │             │              │            │
│  ┌───────┴─────────────┴─────────────┴──────────────┴────────┐  │
│  │                   App State (in-memory)                     │  │
│  │         token · fleetData · activeUnit · currentView       │  │
│  └───────────────┬────────────────────────┬───────────────────┘  │
│                  │                        │                       │
│  ┌───────────────▼──────────┐  ┌──────────▼──────────────────┐  │
│  │      Graph API Layer     │  │   Image Processing Layer     │  │
│  │  auth · excel · files    │  │  capture · warp · threshold  │  │
│  │  sessions · folders      │  │  PDF assembly · compression  │  │
│  └───────────────┬──────────┘  └─────────────────────────────┘  │
│                  │                                                │
│  ┌───────────────▼──────────────────────────────────────────┐   │
│  │                  IndexedDB Cache                          │   │
│  │      fleet data snapshot · pending writes queue          │   │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
          │
          │  HTTPS / Microsoft Graph API v1.0
          ▼
┌─────────────────────────────────────────────────┐
│                  OneDrive / Excel               │
│  /Fleet Maintenance/                            │
│    fleet.xlsx  (tables: Units, Invoices, Maint) │
│    TRK-042/Invoices/TRK-042_2026-03-16_Oil.pdf  │
│    TRL-017/Invoices/...                         │
└─────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| Router | Hash-based view switching; render active view into `#app` | All views, App State |
| Upload View | Scanner trigger, form fields, naming preview, submit | Image Processing, Graph API, App State |
| Dashboard View | Overdue/upcoming maintenance cards, fleet summary | App State (fleet data) |
| Unit Detail View | Per-unit history, condition data, upcoming maintenance | App State (fleet data), Graph API |
| Scanner View | Camera capture, multi-page management, PDF build | Image Processing Layer |
| App State | Central in-memory store; token, fleet data, active selections | All components |
| Graph API Layer | Auth, Excel read/write, file upload, folder creation | OneDrive, App State |
| Image Processing Layer | Deskew, threshold, PDF assembly | Scanner View |
| IndexedDB Cache | Snapshot of fleet.xlsx data; pending write queue for offline | Graph API Layer, App State |
| Service Worker | Cache static assets; serve offline shell | Browser, CDN |

---

## Recommended File Structure

The app currently lives in one flat `app.js`. The brownfield migration path is to split into ES modules loaded with `<script type="module">` — no build tool required.

```
camiora-pwa/
├── index.html              # Entry point, loads app/main.js as module
├── style.css               # Global styles
├── sw.js                   # Service worker (cache static + offline shell)
├── manifest.json           # PWA manifest
│
├── app/
│   ├── main.js             # Boot: auth check, router init, sw registration
│   ├── state.js            # Shared in-memory state object (single source of truth)
│   ├── router.js           # Hash-based router (#upload, #dashboard, #unit/:id)
│   │
│   ├── views/
│   │   ├── upload.js       # Upload + scanner form view
│   │   ├── dashboard.js    # Fleet dashboard view (overdue, upcoming, summary)
│   │   └── unit-detail.js  # Per-unit history + condition view
│   │
│   ├── graph/
│   │   ├── auth.js         # PKCE flow, token save/load/refresh
│   │   ├── excel.js        # fleet.xlsx session management, table read/write
│   │   ├── files.js        # PDF upload, folder creation, listing
│   │   └── api.js          # Shared fetch wrapper (auth header, retry, throttle)
│   │
│   ├── imaging/
│   │   ├── scanner.js      # Camera capture, page management
│   │   ├── pipeline.js     # Deskew, threshold, perspective warp
│   │   └── pdf.js          # jsPDF assembly, JPEG compression
│   │
│   └── storage/
│       ├── cache.js        # IndexedDB read/write (fleet data snapshot)
│       └── sync.js         # Pending write queue, sync-on-reconnect logic
```

### Structure Rationale

- **`app/graph/`:** All Graph API calls isolated here. Views never call `fetch` directly. This boundary makes retry/throttle logic centralised and testable.
- **`app/views/`:** Each view is a module exporting a single `render(container, state)` function. The router calls it; the view owns no URL knowledge.
- **`app/imaging/`:** Image processing is CPU-heavy and completely independent of Graph API. Isolating it lets the pipeline be tested with static images and replaced without touching views.
- **`app/storage/`:** IndexedDB operations separated from Graph. The cache layer is the only thing that knows about IndexedDB; views read from `state.js`, not from IndexedDB directly.
- **No build tool:** ES modules load natively in all modern browsers. GitHub Pages serves `.js` files as-is. Avoids introducing npm/webpack into a static-file project.

---

## Architectural Patterns

### Pattern 1: Hash-Based Router with Render Functions

**What:** `window.location.hash` drives which view is active. A router maps hashes to view modules. Each view exports a `render(container, state)` function. The router calls `render()` with the `#app` container on every `hashchange`.

**When to use:** Multi-view SPA on a static host with no server-side routing support (GitHub Pages returns 404 on unknown paths). Hash routing is purely client-side — the server only ever serves `index.html`.

**Trade-offs:** URLs look like `/#dashboard` not `/dashboard`. Not indexable by search engines, but this is an internal tool — irrelevant. Simple to implement, zero dependencies.

**Example:**
```javascript
// app/router.js
import { render as renderUpload }    from './views/upload.js';
import { render as renderDashboard } from './views/dashboard.js';
import { render as renderUnit }      from './views/unit-detail.js';

const routes = {
  '#upload':    renderUpload,
  '#dashboard': renderDashboard,
  '#unit':      renderUnit,   // #unit?id=TRK-042
};

export function initRouter(container, state) {
  const go = () => {
    const hash = window.location.hash || '#upload';
    const key  = hash.split('?')[0];
    const fn   = routes[key] || renderUpload;
    fn(container, state);
  };
  window.addEventListener('hashchange', go);
  go(); // render on initial load
}
```

### Pattern 2: Excel Session Wrapper (Open → Use → Close)

**What:** Graph API's Excel workbook session must be created before reads/writes, used for all subsequent requests via the `workbook-session-id` header, then explicitly closed. Skipping sessions forces the API to locate the workbook server copy on every call — significantly slower and more prone to throttling.

**When to use:** Any time more than one Excel API call is needed in a single user action (e.g. read fleet data on login, append an invoice row after upload).

**Trade-offs:** Adds two extra API calls (createSession / closeSession). Session IDs expire after ~5 minutes of inactivity — must handle `InvalidSessionIdException` with a re-create-and-retry. Worth it for all multi-call sequences; sessionless is only acceptable for single one-off reads.

**Example:**
```javascript
// app/graph/excel.js
async function withSession(driveItemId, fn) {
  const sessionResp = await graphFetch(
    `/me/drive/items/${driveItemId}/workbook/createSession`,
    { method: 'POST', body: JSON.stringify({ persistChanges: true }) }
  );
  const { id: sessionId } = await sessionResp.json();
  try {
    return await fn(sessionId);
  } finally {
    await graphFetch(
      `/me/drive/items/${driveItemId}/workbook/closeSession`,
      { method: 'POST', headers: { 'workbook-session-id': sessionId } }
    );
  }
}

export async function appendInvoiceRow(driveItemId, row) {
  return withSession(driveItemId, (sessionId) =>
    graphFetch(
      `/me/drive/items/${driveItemId}/workbook/tables/Invoices/rows/add`,
      {
        method: 'POST',
        headers: { 'workbook-session-id': sessionId },
        body: JSON.stringify({ values: [row] }),
      }
    )
  );
}
```

### Pattern 3: Read-Cache-Then-Freshen (Stale-While-Revalidate for Excel Data)

**What:** On app load, read fleet data from IndexedDB immediately (fast, offline-safe). Then fetch fresh data from the Excel workbook in the background. When the fresh data arrives, update state and re-render views.

**When to use:** Dashboard and unit detail views that show fleet data. Users in the field on spotty mobile connections see data instantly; the fetch completes when network allows.

**Trade-offs:** Data may be seconds-to-minutes stale on load. Acceptable for a fleet maintenance tool — nobody needs sub-second accuracy on maintenance history. Do NOT use this pattern for write operations (append invoice row must go to Graph API directly; never write to IndexedDB and defer the Graph write).

**Example:**
```javascript
// app/storage/cache.js
export async function getFleetData()   { /* IndexedDB GET */ }
export async function saveFleetData(d) { /* IndexedDB PUT */ }

// app/main.js
async function loadFleetData(state) {
  const cached = await getFleetData();
  if (cached) { state.fleet = cached; renderActiveView(); }

  // background freshen
  const fresh = await excel.readAllTables(state.workbookId);
  if (fresh) {
    state.fleet = fresh;
    await saveFleetData(fresh);
    renderActiveView();
  }
}
```

### Pattern 4: Sequential Writes Only (Excel API Constraint)

**What:** Never issue concurrent write requests to the same workbook. Queue writes and send them one-at-a-time, waiting for the previous response before sending the next.

**When to use:** Always, for any Excel write operation (append row, update cell).

**Trade-offs:** Slower throughput. Not a real limitation — this app typically writes 1-2 rows per user action. The alternative (concurrent writes) causes merge conflicts, throttling, and data corruption in Excel.

---

## Data Flow

### Invoice Upload Flow (Core Flow)

```
User fills form + scans document
        ↓
pipeline.js — deskew → threshold → canvas[]
        ↓
pdf.js — jsPDF assembly, JPEG FAST compression → Blob (~500KB)
        ↓
Upload View — validates form, constructs filename + folder path
        ↓
graph/files.js — ensureFolder() → uploadFile() → PUT /drive/items/:id/content
        ↓
graph/excel.js — withSession() → appendInvoiceRow() → POST /tables/Invoices/rows/add
        ↓
State update → re-render file list + toast
```

### Dashboard Load Flow

```
App boots → auth check (sessionStorage)
        ↓ (authenticated)
storage/cache.js — read IndexedDB snapshot → state.fleet
        ↓ (immediate)
router.js → renderDashboard(container, state)  [renders with cached data]
        ↓ (background)
graph/excel.js — readAllTables(workbookId) → fresh fleet data
        ↓
storage/cache.js — saveFleetData(fresh)
state.fleet = fresh → re-render dashboard [updates with live data]
```

### State Management

```
state.js (in-memory singleton)
  ├── token          — OAuth access token (also in sessionStorage)
  ├── fleet          — { units[], invoices[], maintenance[] } from Excel
  ├── workbookId     — OneDrive item ID for fleet.xlsx (fetched once, cached)
  ├── scanPages      — canvas[] for current scan session
  ├── activeUnitId   — currently viewed unit in unit-detail view
  └── isUploading    — boolean, disables submit during active upload

Views READ from state.
Views WRITE to state via action functions (never directly mutate state.fleet).
Action functions call graph/* modules for persistence.
```

### Key Data Flows Summary

1. **Auth:** sessionStorage → PKCE redirect → token exchange → state.token + sessionStorage
2. **Fleet data read:** IndexedDB (instant) → Graph Excel API (background freshen) → state.fleet → views
3. **Invoice write:** Form → image pipeline → PDF → Graph file upload + Excel row append → state update
4. **Maintenance data:** Same as fleet data read; writes are sequential Excel row appends
5. **Unit list (dropdowns):** state.fleet.units — populated from Excel `Units` table on load

---

## Excel Workbook Structure

The fleet.xlsx file on OneDrive must use named Excel Tables (not plain ranges) so Graph API table operations work. Three tables cover all data needs:

| Table Name | Columns | Purpose |
|------------|---------|---------|
| `Units` | UnitId, Type, Number, Make, Model, Year, Status | Master list for dropdowns and unit pages |
| `Invoices` | InvoiceId, UnitId, Date, Vendor, Cost, Type, Notes, FilePath | Invoice history per unit |
| `Maintenance` | MaintId, UnitId, Type, DueDate, LastDone, Interval, Notes | Scheduled maintenance tracking |

Graph API endpoints used:

```
GET  /me/drive/items/{id}/workbook/tables/Units/rows        — load unit list
GET  /me/drive/items/{id}/workbook/tables/Invoices/rows     — load invoice history
POST /me/drive/items/{id}/workbook/tables/Invoices/rows/add — append new invoice
GET  /me/drive/items/{id}/workbook/tables/Maintenance/rows  — load schedule
POST /me/drive/items/{id}/workbook/tables/Maintenance/rows/add — add maintenance record
```

Important: Only `.xlsx` format is supported by Graph Excel API. `.xls` is not supported (HIGH confidence — official docs).

---

## Scalability Considerations

This is a small internal tool. Scaling concerns are throughput and data size, not user count.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 users (current) | Single `fleet.xlsx` is fine; sequential writes trivially safe; no conflict risk |
| 10-20 users (plausible growth) | Sequential writes remain correct; Excel has no row limit issue at this scale; sessions prevent merge conflicts |
| 500+ invoices / year | Read all rows on load becomes slow. Add `$top` + pagination to table row reads; cache aggressively in IndexedDB |
| Excel limits hit (1M rows max, very unlikely) | Not a realistic concern for a single fleet operator |

**First bottleneck:** Excel session creation latency (~1-3s on first open of a large workbook). Mitigation: `Prefer: respond-async` header + polling loop for session creation; cache workbook item ID in IndexedDB so the file doesn't need to be re-looked-up each session.

**Second bottleneck:** Graph API throttling if invoices are uploaded in rapid succession. Mitigation: sequential requests already applied; exponential backoff on 429 responses using `Retry-After` header.

---

## Anti-Patterns

### Anti-Pattern 1: Concurrent Excel Writes

**What people do:** Fire multiple `rows/add` calls in parallel with `Promise.all()` to speed up multi-row inserts.

**Why it's wrong:** The Excel API serialises concurrent requests internally but doesn't do so reliably — it causes merge conflicts, timeout errors (requests queue on the server), and 429 throttling. The error state is ambiguous: you can't tell which writes succeeded.

**Do this instead:** Sequential writes with `await` between each. At this app's scale (1-2 rows per user action) parallelism provides no real benefit.

### Anti-Pattern 2: Re-reading Excel on Every View Render

**What people do:** Call `readAllTables()` inside every view's render function so data is always fresh.

**Why it's wrong:** Each Graph Excel API call takes 500ms-2s. Navigating between views would trigger 2-5 API calls per navigation, with noticeable lag on mobile. Excel sessions also have a concurrency limit.

**Do this instead:** Load fleet data once on app boot using the read-cache-then-freshen pattern. Views read from `state.fleet` (in-memory). Add a manual "refresh" button in the dashboard for users who need guaranteed fresh data.

### Anti-Pattern 3: Storing Auth Tokens in localStorage

**What people do:** Move the OAuth token from `sessionStorage` to `localStorage` for persistence across tabs and browser restarts.

**Why it's wrong:** `localStorage` is accessible to any script running on the same origin (XSS attack surface). For a GitHub Pages app, this risk is low but the token grants full access to the user's OneDrive. `sessionStorage` scope (per-tab) is the safer default for OAuth tokens in SPAs without a backend.

**Do this instead:** Keep tokens in `sessionStorage`. Accept that the user must re-authenticate when they open a new tab. This is the current implementation — preserve it.

### Anti-Pattern 4: One Monolithic app.js for Multi-View App

**What people do:** Add dashboard and unit detail views as more functions at the bottom of the existing `app.js`, growing it to 2000+ lines.

**Why it's wrong:** Dashboard and unit detail views introduce substantial new logic (data aggregation, conditional rendering, maintenance schedule calculations). In a single file, concerns bleed into each other, making targeted changes risky. The image processing pipeline already has 200+ lines of canvas manipulation that has nothing to do with fleet data display.

**Do this instead:** Split into ES modules (`app/views/`, `app/graph/`, `app/imaging/`) loaded natively with `<script type="module">`. No build tool needed — browsers load native ES modules directly from GitHub Pages.

---

## Integration Points

### External Services

| Service | Integration Pattern | Gotchas |
|---------|---------------------|---------|
| Microsoft OAuth (login.microsoftonline.com) | PKCE redirect flow — already working | Token expires after 1h; no refresh token in PKCE SPA flow without MSAL — user must re-auth after expiry |
| Microsoft Graph API v1.0 | REST fetch with Bearer token | Excel API requires `.xlsx`; requires named Tables (not plain ranges); sessions expire after ~5min idle |
| jsPDF (CDN) | `<script src>` loaded globally | v4.0+ uses `fflate` instead of `pako` — faster compression. Existing `addImage()` calls with JPEG + FAST compression already correct |
| GitHub Pages | Static file hosting, no server | Cannot do server-side redirects; hash routing required; all files served from root |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Views ↔ App State | Views read `state.*` directly; write via exported action functions in `graph/*` modules | Views must not import from `graph/*` directly — go through action functions in `state.js` or a thin controller |
| Graph Layer ↔ IndexedDB Cache | After each successful Excel read, `cache.js` is called to snapshot. Graph layer does not know about IndexedDB structure | The cache module is the only place that knows IndexedDB schema |
| Image Pipeline ↔ Upload View | Upload view calls `pipeline.processImage(imageFile)` → returns canvas. Pipeline has no knowledge of form state | Clean boundary — pipeline can be tested in isolation |
| Router ↔ Views | Router calls `view.render(container, state)`. Views do not manipulate the URL. Navigation is `window.location.hash = '#dashboard'` from within views | Views must not listen to `hashchange` directly |

---

## Build Order Implications for Roadmap

Dependencies between components dictate the order phases must be built:

```
1. graph/api.js (shared fetch wrapper + retry)
        ↓ required by
2. graph/auth.js (already exists — extract to module)
        ↓ required by
3. graph/excel.js (session management, table read)
        ↓ required by
4. state.js + storage/cache.js (load fleet data, populate state)
        ↓ required by
5. router.js (can now switch views with real data)
        ↓ required by
6a. views/dashboard.js (reads state.fleet)
6b. views/unit-detail.js (reads state.fleet by unit)
        both depend on (4) but are independent of each other

7. graph/files.js + imaging/* already exist — extract, don't rewrite
8. graph/excel.js write path (appendInvoiceRow) — adds to step 3

Storage/sync.js (pending write queue) is optional for MVP — add after core write flow works.
```

The critical path is: **shared fetch wrapper → Excel read → state/cache → router → dashboard view**. The image processing pipeline (already working) can be extracted to a module independently.

---

## Sources

- [Best practices for working with the Excel API — Microsoft Graph](https://learn.microsoft.com/en-us/graph/workbook-best-practice) — HIGH confidence, official docs updated 2025-08-06
- [Create TableRow — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/table-post-rows?view=graph-rest-1.0) — HIGH confidence
- [Manage sessions and persistence in Excel — Microsoft Graph](https://learn.microsoft.com/en-us/graph/excel-manage-sessions) — HIGH confidence
- [Working with Excel in Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0) — HIGH confidence
- [JavaScript modules — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — HIGH confidence, native ES module support in all modern browsers
- [Going Buildless: ES Modules — Modern Web](https://modern-web.dev/guides/going-buildless/es-modules/) — MEDIUM confidence
- [Offline data — web.dev](https://web.dev/learn/pwa/offline-data) — MEDIUM confidence, IndexedDB as offline store for PWAs
- [jsPDF repository — parallax/jsPDF](https://github.com/parallax/jsPDF) — MEDIUM confidence, v4 fflate compression improvement

---

*Architecture research for: No-backend PWA with OneDrive/Excel as database*
*Researched: 2026-03-16*

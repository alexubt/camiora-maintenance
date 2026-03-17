# Project Research Summary

**Project:** Camiora — Fleet Maintenance PWA (KINGPIN Trucking)
**Domain:** Mobile-first internal fleet maintenance PWA with OneDrive as database
**Researched:** 2026-03-16
**Confidence:** MEDIUM-HIGH

## Executive Summary

Camiora is a no-backend, mobile-first internal tool that replaces manual invoice filing for a small trucking fleet. It runs entirely in the browser, stores data on OneDrive (Microsoft 365), and uses the existing PKCE/Graph API auth stack. The recommended build approach is: CSV files on OneDrive as the data layer (simpler than Excel workbook sessions), client-side CSV parsing (no SheetJS dependency), and a split-module ES architecture using native ES modules with no build step. The core user value is: scan an invoice on a phone, have it auto-named and filed in the right OneDrive folder in two taps — with maintenance tracking as a second-tier capability.

**The most important architectural decision already made:** CSV files on OneDrive instead of Excel workbook API. The user downloads CSV via the same Graph API file endpoints already used for PDF upload, parses client-side with plain string splitting, and writes back using optimistic locking (hash the original, re-download before save, diff-merge). This eliminates Excel session management, removes SheetJS as a dependency, and sidesteps the concurrent-write complexity that was the research's top-rated pitfall. The tradeoff is manual merge logic on write conflicts, but for a small team this is acceptable and straightforward to implement.

The primary risks are iOS-specific: canvas memory limits on older iPhones (224 MB hard cap), Safari's 7-day IndexedDB eviction for non-installed PWAs, and camera permission re-prompting in standalone mode. All three are avoidable with known mitigations. The secondary risk is concurrent CSV writes from two users — the optimistic locking strategy (hash-compare before PUT) handles this correctly at this team's scale.

---

## Key Findings

### Recommended Stack

**Decision override applied:** The research recommended SheetJS for Excel parsing. That recommendation is superseded. The data layer is CSV on OneDrive, parsed client-side with `String.split('\n').map(row => row.split(','))`. No SheetJS dependency needed.

The existing codebase is vanilla JS, CDN-only, no build step. All new additions must respect that constraint. The only library requiring an upgrade is jsPDF: the current 2.5.2 has a CVE (CVE-2025-68428) and PNG encoding regressions; upgrading to 4.2.0 is a one-line CDN URL change with no API differences for the existing `addImage()` usage.

**Core technologies:**
- **jsPDF 4.2.0** (CDN): PDF generation from canvas images — security fix and compression improvements over 2.5.2 already in use; drop-in upgrade
- **Canvas API** (built-in): B&W filter and perspective warp — already implemented; needs tuning, not replacement
- **Microsoft Graph API v1.0** (existing): Auth (PKCE) and OneDrive file operations — same endpoints used for PDF upload will be used for CSV download/upload
- **ES modules** (native, no bundler): Module split via `<script type="module">` — no build tooling needed, GitHub Pages serves `.js` files directly
- **IndexedDB** (built-in): Offline cache for CSV snapshots and pending write queue

**What NOT to add:**
- SheetJS — not needed; plain CSV parsing is sufficient
- Excel workbook session API — dropped; raw file GET/PUT is cleaner
- OpenCV.js — 7-8 MB; use only as lazy-loaded fallback if Canvas perspective warp quality proves inadequate
- Tesseract.js — removed in commit ae67a4c; do not reintroduce

### Expected Features

Features are structured around two delivery tiers: the invoice filing workflow (v1) and the maintenance tracking hub (v1.x).

**Must have (table stakes):**
- Unit roster loaded from CSV on OneDrive — root dependency; everything attaches to a unit
- Invoice capture: camera scan, deskew, B&W filter, PDF at ~500KB
- Maintenance type selection (presets + custom text field)
- Auto-naming: `UNIT_DATE_TYPE.pdf`
- Upload to per-unit OneDrive folder
- Invoice history per unit (folder listing via Graph API)
- Scheduled maintenance tracking (interval-based: mileage + time)
- Overdue maintenance alerts (calculated client-side at read time)
- DOT inspection status per unit (annual expiry badge)
- Dashboard: action-focused "what needs attention now" — overdue + due-soon items only

**Should have (competitive differentiators):**
- Polished document scanner with edge detection and B&W filter — competitors accept file uploads; this is camera-first
- Invoice linked directly to maintenance record via filename convention — creates audit trail without a server
- Offline-capable capture with upload queue — field use in shops with poor connectivity
- Mileage/odometer entry per unit — enables mileage-based PM intervals
- Unit detail page — single-unit view: history, condition, upcoming schedule

**Defer (v2+):**
- Tire tracking per unit (rotation interval, condition notes)
- Offline upload queue with retry (service worker queued writes)
- Cost totals per unit
- Fuel log entry

**Anti-features — explicitly out of scope:**
- GPS/telematics, push notifications, driver portal, multi-tenant, full work order management, parts inventory

### Architecture Approach

The app follows a client-only architecture: no server, no backend, no build pipeline. OneDrive is the database. The correct module split is `app/graph/` (all Graph API calls), `app/views/` (render functions), `app/imaging/` (canvas pipeline), and `app/storage/` (IndexedDB cache). The current 909-line `app.js` monolith must be split before adding dashboard and maintenance tracking — adding more views to the monolith will make targeted changes risky.

**Data layer — updated for CSV decision:**
The `app/graph/excel.js` module described in ARCHITECTURE.md becomes `app/graph/csv.js`. The session management wrapper (`withSession`) is eliminated entirely. The pattern is:
1. `GET /me/drive/items/{id}/content` — download CSV as text
2. Hash the raw string (MD5 or SHA-1 via SubtleCrypto)
3. Parse client-side: `lines.map(l => l.split(','))`
4. Mutate in-memory array
5. Before write: re-download CSV, hash again
6. If hashes match: `PUT /me/drive/items/{id}/content` with new CSV text
7. If hashes differ: diff-merge changes, then write (or surface conflict to user)

**Major components:**
1. **Router** (`app/router.js`) — hash-based view switching; `#upload`, `#dashboard`, `#unit?id=TRK-042`
2. **App State** (`app/state.js`) — in-memory singleton: token, fleet data (from CSV), activeUnitId, scan pages
3. **Graph CSV Layer** (`app/graph/csv.js`) — download/parse/write CSV; optimistic lock logic; no session management
4. **Graph Files Layer** (`app/graph/files.js`) — PDF upload, folder creation, folder listing (already exists, extract to module)
5. **Image Processing Layer** (`app/imaging/`) — scanner, deskew pipeline, jsPDF assembly; already implemented, extract to module
6. **IndexedDB Cache** (`app/storage/cache.js`) — snapshot of parsed CSV data; serves offline reads instantly
7. **Service Worker** (`sw.js`) — cache static assets + app shell; update strategy must bump cache version on every deploy

**Key patterns:**
- Read-cache-then-freshen: serve IndexedDB snapshot immediately, background-fetch fresh CSV, re-render on update
- Sequential writes only: one CSV write at a time, never concurrent
- Optimistic locking: hash-compare before every PUT to detect concurrent edits
- Views read from `state.*` only; never call `fetch` directly

### Critical Pitfalls

1. **CSV concurrent write collision** — Two users submit at the same moment. Without optimistic locking both may PUT their version, and one overwrites the other. Prevention: always re-download and hash-compare the CSV before every write. On hash mismatch, diff-merge or prompt the user. For a 2-3 person team, "last write wins with a visible conflict warning" is acceptable. Address this in the CSV data layer phase before any multi-user write path goes live.

2. **iOS canvas memory limit (224 MB)** — Accumulating live canvas objects across multiple scans crashes the app on older iPhones. Prevention: immediately after adding a page to `scanPages`, convert the canvas to a JPEG blob and call `canvas.width = 0` to release GPU memory. Store blobs, not canvases. Cap `scanPages` at 20. Address this in the scanner improvement phase before shipping deskew or resolution increases.

3. **iOS 7-day IndexedDB eviction** — Safari clears all storage for browser-tab PWAs after 7 days without a user visit. Prevention: require Home Screen install (which grants persistent storage). Treat IndexedDB as a cache, not a source of truth — OneDrive CSV is the source of truth and survives eviction. Address in PWA onboarding phase.

4. **Service worker cache never updating** — Deploying new code leaves existing users on the old cached version indefinitely. Prevention: bump the `CACHE` version string in `sw.js` on every deploy (use a date: `camiora-2026-03-16`); add `skipWaiting()` in the install handler. Address before distributing beyond the developer.

5. **Token expiry mid-session** — The Graph API token expires after ~1 hour. A user who fills out a long maintenance form then uploads will hit an auth error at the worst moment. Prevention: check token expiry before every API call; silently re-authenticate if < 5 minutes remain. Address in the auth hardening phase.

---

## Implications for Roadmap

Based on the combined research, the natural phase structure follows the feature dependency graph: unit roster first (root dependency), then invoice workflow (existing core — polish not rewrite), then maintenance tracking (requires unit roster + data layer), then dashboard (aggregates everything).

### Phase 1: Foundation — Module Split and CSV Data Layer

**Rationale:** The current monolithic `app.js` cannot safely absorb dashboard and maintenance views. Module splitting is a prerequisite for all subsequent phases. Simultaneously, the CSV data layer (unit roster read) is the root dependency for every other feature — nothing can be built without units being selectable. These two concerns are structurally linked: the CSV layer is the first module to extract.

**Delivers:**
- ES module structure: `app/graph/`, `app/views/`, `app/storage/`, `app/main.js`, `app/router.js`
- `app/graph/csv.js` — CSV download, parse, write with optimistic locking
- `app/storage/cache.js` — IndexedDB snapshot of CSV data
- Unit roster available in-memory (`state.fleet.units`) for all downstream selectors
- Hash-based router with upload as the default view

**Addresses:** Unit roster from OneDrive, auto-naming, maintenance type selection (data layer only)
**Avoids:** Concurrent write corruption (optimistic lock built in from the start), monolith growth anti-pattern

**Research flag:** This phase has well-documented patterns (ES module split, IndexedDB, Graph API file GET/PUT). No phase-level research needed.

---

### Phase 2: Invoice Workflow Polish

**Rationale:** The existing invoice upload works but has known quality issues: jsPDF 2.5.2 CVE, B&W filter not fully wired, no filename preview, no reliable retry on upload failure, and the UX pitfalls around silent failures. This phase closes the core loop end-to-end with production quality. It must come before maintenance tracking because reliable invoice capture is the primary user value.

**Delivers:**
- jsPDF upgraded to 4.2.0 (CVE fix, compression improvement)
- `app/imaging/` module: scanner, pipeline (deskew + B&W threshold), PDF assembly — extracted from monolith, not rewritten
- Canvas memory management: blob conversion after each scan, `canvas.width = 0` release, page cap at 20
- Filename preview before upload (shows `UNIT_DATE_TYPE.pdf` and target folder)
- Silent failure fix: keep form + pages in memory on failure, show Retry button
- iOS camera: confirm `<input type="file" capture="environment">` is used (not `getUserMedia`)
- Service worker cache version strategy: date-stamped `CACHE` key, `skipWaiting()`

**Addresses:** Invoice capture (polished), auto-naming, upload to per-unit folder, invoice history per unit
**Avoids:** Canvas OOM crash, iOS camera re-permission bug, silent upload failure, service worker staleness

**Research flag:** Scanner pipeline improvements are well-documented via Canvas API. No phase-level research needed. If deskew quality is inadequate after tuning, `perspective-transform` (3KB) is the researched fallback — do not reach for OpenCV.js first.

---

### Phase 3: Maintenance Tracking

**Rationale:** Once invoice filing is reliable, the maintenance tracking layer gives users a reason to open the app beyond filing invoices. This phase adds PM scheduling, overdue calculation, and DOT inspection status — all computed client-side from CSV data. The CSV data model must be extended to include a Maintenance table (second CSV file, or a second sheet encoded in the same CSV).

**Delivers:**
- Maintenance CSV schema: `MaintId, UnitId, Type, DueDate, LastDone, Interval, Notes`
- Mileage/odometer entry per unit (standalone entry or at invoice upload time)
- Scheduled maintenance setup per unit (oil, DOT, tires, brakes — preset + custom)
- Overdue calculation at read time: `today > DueDate` or `currentMileage > LastMileage + Interval`
- DOT inspection expiry badge per unit (date + 12-month interval)
- `app/views/unit-detail.js` — per-unit history, condition, upcoming PM schedule

**Addresses:** Scheduled maintenance tracking, overdue alerts, DOT inspection status, mileage tracking, unit detail page
**Avoids:** Re-reading CSV on every view render (read-cache-then-freshen pattern from Phase 1 applies here too)

**Research flag:** Standard patterns, no phase-level research needed. The only non-obvious decision is whether maintenance records live in the same CSV as units or a separate file — recommend separate file for simpler optimistic locking (fewer concurrent write conflicts on different data domains).

---

### Phase 4: Dashboard

**Rationale:** The dashboard aggregates data from all prior phases. It is last because it has no unique logic of its own — it reads `state.fleet` (units + maintenance) and renders an attention list. Building it last means the data model is stable and the component can be a thin read-only view.

**Delivers:**
- `app/views/dashboard.js` — action-focused: overdue PM items, due-soon items, expired/expiring DOT inspections
- Fleet summary counts (total units, overdue count, due-soon count)
- Navigation to unit detail from dashboard cards
- No charts, no KPIs — action list only (research confirms this is the right call for a small team)

**Addresses:** Dashboard (attention-focused), overdue maintenance alerts surface
**Avoids:** Re-reading data on each render (all data from `state.fleet`), complexity creep toward reporting/analytics

**Research flag:** No research needed. This is a read-only aggregation view of already-loaded state.

---

### Phase 5: Auth Hardening and PWA Onboarding

**Rationale:** Auth token expiry mid-session and iOS storage eviction are both in the "looks done but isn't" category. They don't appear in normal testing but will hit users in production. This phase addresses the reliability layer before the app is distributed to the full team.

**Delivers:**
- Token expiry check before every API call; proactive silent re-auth when < 5 min remain
- "Session expiring" warning at 55 minutes of active use
- PWA install banner with Home Screen install instructions (grants persistent storage on iOS)
- Input path sanitization: whitelist `[A-Za-z0-9-_]` on unit IDs before OneDrive path construction
- Subresource integrity hash on jsPDF CDN tag (or self-host the file)
- Graph API retry wrapper: reads `Retry-After` header on 429, waits exact duration, retries up to 3 times

**Addresses:** Offline reliability, token expiry, iOS storage eviction, security hardening
**Avoids:** Token expiry mid-upload, iOS 7-day eviction data loss, OneDrive path traversal

**Research flag:** No research needed. Patterns are well-documented in official Microsoft Graph docs.

---

### Phase Ordering Rationale

- **Module split must come first** — the monolith cannot safely absorb 3+ new views. Every subsequent phase writes to the module structure established in Phase 1.
- **CSV data layer is Phase 1, not Phase 2** — unit roster is the root dependency of every feature. Nothing can be built without it.
- **Invoice polish before maintenance tracking** — the existing core flow is the primary user value; it must be production-quality before adding new capabilities.
- **Dashboard is last** — it has no unique logic; it is an aggregation view of stable data from prior phases.
- **Auth hardening is a phase, not an afterthought** — token expiry and iOS eviction are production issues that don't appear in dev testing. Scheduling them as a named phase ensures they don't get deferred indefinitely.

### Research Flags

**Phases with well-documented patterns (no phase-level research needed):**
- Phase 1 (Foundation/CSV layer): ES modules, IndexedDB, Graph API file endpoints are well-documented
- Phase 2 (Invoice polish): Canvas API, jsPDF, iOS camera input patterns are confirmed
- Phase 3 (Maintenance tracking): Interval-based PM calculations are standard logic; CSV schema is straightforward
- Phase 4 (Dashboard): Read-only aggregation view; no new integrations
- Phase 5 (Auth hardening): Microsoft Graph token refresh and Graph API retry patterns are documented in official sources

**Potential research trigger during Phase 2:**
If deskew quality after Canvas-based perspective warp is unacceptable, evaluate `perspective-transform` (jlouthan, 3KB) before considering OpenCV.js. This is a known decision branch, not an unknown — no upfront research needed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | jsPDF version and CVE confirmed from GitHub releases; CSV approach is simpler than researched Excel path — higher confidence due to lower complexity; OpenCV.js size confirmed from official sources |
| Features | MEDIUM | Feature set verified against Fleetio, AUTOsist, Simply Fleet, and industry guides; priorities inferred from project constraints — internal tool priorities may differ from market norms |
| Architecture | HIGH | Graph API patterns from official Microsoft docs (updated 2025-08-06); ES module pattern from MDN; CSV optimistic locking is a standard read-modify-write pattern |
| Pitfalls | HIGH | iOS canvas limit, Safari eviction policy, and camera permission bug all backed by official Apple/WebKit sources; Excel session complexity eliminated by CSV decision |

**Overall confidence:** HIGH

### Gaps to Address

- **CSV schema finalization:** The exact column structure for units, invoices, and maintenance CSVs must be defined before Phase 1 begins. The ARCHITECTURE.md Excel schema is a starting point but must be adapted for CSV (no named table references, header row required). Decide: one CSV file with multiple sections, or separate files per domain. Recommendation: separate files (`units.csv`, `invoices.csv`, `maintenance.csv`) for simpler optimistic locking.

- **Concurrent write UX:** The optimistic locking strategy detects collisions but the user-facing resolution flow is not specified. For a 2-3 person team, "show a conflict warning, display both versions, let the user pick" is sufficient. Define this UX before implementing the write path.

- **OneDrive folder structure:** The exact OneDrive path layout (where CSVs live vs. where PDFs live) must be decided and locked early. Changes after Phase 2 would require migrating existing files. Suggested: `/Fleet Maintenance/data/units.csv`, `/Fleet Maintenance/data/invoices.csv`, `/Fleet Maintenance/TRK-042/TRK-042_2026-03-16_Oil.pdf`.

- **Token refresh in PKCE flow:** The existing PKCE flow does not use MSAL and has no refresh token. After 1 hour, users must re-authenticate via a full redirect. Phase 5 must decide: accept re-auth redirect (simple), or introduce MSAL.js for silent token refresh (adds a dependency). This is a trade-off to evaluate, not a researched recommendation.

---

## Sources

### Primary (HIGH confidence)
- [Microsoft Graph Excel API Best Practices](https://learn.microsoft.com/en-us/graph/workbook-best-practice) — session management, concurrent write constraints
- [Microsoft Graph Throttling](https://learn.microsoft.com/en-us/graph/throttling) — Retry-After header behavior
- [WebKit Storage Policy Updates](https://webkit.org/blog/14403/updates-to-storage-policy/) — iOS 7-day eviction confirmed
- [WebKit Bug 215884](https://bugs.webkit.org/show_bug.cgi?id=215884) — iOS camera permission re-prompt in standalone PWA
- [jsPDF GitHub Releases](https://github.com/parallax/jsPDF/releases) — v4.2.0 confirmed, CVE-2025-68428
- [Apple Developer Forums: Canvas memory limit](https://developer.apple.com/forums/thread/687866) — 224 MB iOS canvas hard cap
- [MDN: JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — native ES module browser support

### Secondary (MEDIUM confidence)
- [Fleetio](https://www.fleetio.com/), [AUTOsist](https://autosist.com/), [Simply Fleet](https://www.simplyfleet.app/) — competitor feature baseline
- [Annual DOT Inspection Guide](https://www.ntassoc.com/annual-dot-inspection-the-ultimate-guide) — 12-month interval confirmed
- [Modern Web: Going Buildless](https://modern-web.dev/guides/going-buildless/es-modules/) — ES module patterns without build tools
- Existing codebase analysis: `.planning/codebase/CONCERNS.md` — direct audit of current state

---

*Research completed: 2026-03-16*
*Ready for roadmap: yes*

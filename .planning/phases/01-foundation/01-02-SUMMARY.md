---
phase: 01-foundation
plan: 02
subsystem: infra
tags: [es-modules, router, pkce-auth, onedrive, service-worker]

# Dependency graph
requires:
  - "01-01: CSV data layer (state.js, csv.js, cache.js)"
provides:
  - "PKCE auth module with state.token integration (app/graph/auth.js)"
  - "OneDrive folder/file upload with segment-by-segment path encoding (app/graph/files.js)"
  - "Upload form view with addEventListener event binding (app/views/upload.js)"
  - "Hash-based SPA router (app/router.js)"
  - "Boot sequence module entry point (app/main.js)"
  - "Service worker v4 caching all ES modules"
affects: [02-fleet, 03-scanning, 04-history, 05-search, 06-sync]

# Tech tracking
tech-stack:
  added: []
  patterns: [es-module-entry-point, hash-router, event-delegation, module-level-state]

key-files:
  created:
    - app/graph/auth.js
    - app/graph/files.js
    - app/views/upload.js
    - app/router.js
    - app/main.js
  modified:
    - index.html
    - sw.js
    - app.js

key-decisions:
  - "Inline onclick handlers replaced with addEventListener + data-action attributes"
  - "Event delegation used for dynamic scan page and file list remove buttons"
  - "signOut() no longer calls renderAuth — caller handles re-rendering via router"
  - "Fleet data loaded in background without awaiting (UI renders first)"

patterns-established:
  - "View modules export render(container) function, receive #app div"
  - "Router clears container.innerHTML before calling view render"
  - "Event delegation with data-action and data-index for dynamic lists"
  - "Module-level let for view-local state (files array), shared state via import"

requirements-completed: [INFRA-04, FLEET-01]

# Metrics
duration: 6min
completed: 2026-03-17
---

# Phase 1 Plan 2: ES Module Extraction Summary

**910-line app.js monolith extracted into 5 ES modules with hash router, addEventListener event binding, and segment-by-segment OneDrive path encoding**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-17T03:25:33Z
- **Completed:** 2026-03-17T03:31:33Z
- **Tasks:** 2
- **Files created:** 5
- **Files modified:** 3

## Accomplishments
- Extracted all auth functions into app/graph/auth.js using state.token instead of global accessToken
- Extracted OneDrive upload functions into app/graph/files.js with fixed segment-by-segment path encoding
- Migrated entire upload form UI (800+ lines) into app/views/upload.js with all inline handlers converted to addEventListener
- Created hash-based SPA router dispatching #upload to upload view
- Boot module (main.js) handles SW registration, OAuth code exchange, token loading, router init, and background fleet data loading
- Updated service worker to v4 caching all 8 module files
- Retired app.js (comment-only) for safe cache transition

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract auth.js, files.js, upload.js, router.js, main.js** - `a7457ae` (feat)
2. **Task 2: Update index.html and sw.js, retire app.js** - `bd1f3cd` (feat)

## Files Created/Modified
- `app/graph/auth.js` - PKCE auth functions (CONFIG, SCOPES, GRAPH, startLogin, exchangeCodeForToken, saveToken, loadToken, signOut)
- `app/graph/files.js` - OneDrive ensureFolder and uploadFile with segment-by-segment encoding
- `app/views/upload.js` - Full upload form view with auth screen, scanner, file handling, naming, submit
- `app/router.js` - Hash-based SPA router with ROUTES map
- `app/main.js` - Boot sequence: SW register, auth check, router init, fleet data loading
- `index.html` - Changed script tag to type=module src=app/main.js
- `sw.js` - Cache v4 with all module paths in STATIC array
- `app.js` - Retired (single comment line)

## Decisions Made
- All inline onclick/onchange/oninput handlers replaced with addEventListener after innerHTML assignment
- Event delegation used for dynamically-rendered scan page remove buttons and file list remove buttons (data-action + data-index attributes)
- signOut() in auth.js no longer calls renderAuth directly -- the upload view handles re-rendering after signOut
- loadFleetData() fires in background without await so UI renders immediately
- app.js kept as empty file (not deleted) to prevent 404s from old cached service workers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Module structure in place for all future view additions (new routes in router.js)
- Auth module ready for use by any module via import
- Files module ready for OneDrive operations with correct path encoding
- State singleton wired through all modules
- Fleet data loading pipeline ready (CSV download -> parse -> cache)

---
*Phase: 01-foundation*
*Completed: 2026-03-17*

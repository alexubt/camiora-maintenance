---
phase: 09-live-camera-document-scanner
plan: 03
subsystem: imaging
tags: [live-scanner, upload-wiring, service-worker, pdf-fix, cleanup]

# Dependency graph
requires:
  - phase: 09-02
    provides: app/imaging/live-scanner.js with openLiveScanner API
provides:
  - app/views/upload.js — wired to live scanner with onDone/onCancel/onFallback
  - sw.js v28 — caches scanner-core.js, detect-worker.js, live-scanner.js
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dynamic import of live-scanner.js on user gesture (openCamera is user-initiated)"
    - "onDone uses concat to append blobs (handles add-more-pages case without replacing existing pages)"
    - "PDF assembled exactly once in triggerExtractionFromScan — O(N) not O(N^2)"
    - "removeScanPage clears cached PDF from files[] without rebuilding"

key-files:
  created: []
  modified:
    - app/views/upload.js
    - sw.js
  deleted:
    - app/imaging/reviewScreen.js

key-decisions:
  - "Dynamic import used for live-scanner.js in openCamera (user gesture ensures module loads just-in-time)"
  - "onFallback creates a fresh <input capture> element programmatically (not reusing #cameraInput) to allow repeat fallback triggers"
  - "buildPdfFromPages deferred to triggerExtractionFromScan — single assembly call per scan session"
  - "removeScanPage clears files[] PDF cache without rebuilding so next Done gets fresh assembly"

requirements-completed: [LIVE-07, LIVE-08, LIVE-09]

# Metrics
duration: 3min
completed: 2026-03-30
---

# Phase 9 Plan 03: Upload Wiring and Integration Summary

**Live scanner wired into upload.js via dynamic import, O(N^2) PDF build fixed to single call on Done, sw.js bumped to v28 with all three new imaging modules, reviewScreen.js deleted**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-30T14:37:02Z
- **Completed:** 2026-03-30T14:40:01Z
- **Tasks:** 2
- **Files modified:** 2
- **Files deleted:** 1

## Accomplishments

- Replaced `openCamera()` native input trigger with `openLiveScanner` dynamic import and structured callbacks (`onDone`, `onCancel`, `onFallback`)
- `onDone` appends blobs via `state.scanPages.concat(scannedBlobs)` — handles both first-scan and add-more-pages cases without overwriting existing pages
- `onFallback` creates a fresh programmatic `<input capture>` with toast notification and wires it to `handleCameraCapture`
- Removed `await buildPdfFromPages()` from `handleCameraCapture` (was called after every page capture — O(N^2) work)
- Removed `buildPdfFromPages()` from `removeScanPage` — now clears cached PDF from `files[]` so it will be rebuilt fresh on Done
- Added `await buildPdfFromPages()` at the top of `triggerExtractionFromScan` — PDF assembled exactly once per session
- Bumped sw.js from `camiora-v27` to `camiora-v28` — old cache evicted on next activation
- Added `scanner-core.js`, `detect-worker.js`, `live-scanner.js` to STATIC list in sw.js after `scanner.js`
- Removed stale "Tesseract" CDN comment from sw.js fetch handler (Tesseract removed in Phase 8)
- Deleted `app/imaging/reviewScreen.js` — confirmed no active imports in codebase before deletion

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire live scanner into upload.js and fix O(N^2) PDF build** — `f096454` (feat)
2. **Task 2: Update service worker cache and delete reviewScreen.js** — `d9ec5d8` (feat)

## Files Created/Modified

- `app/views/upload.js` — openCamera() replaced with openLiveScanner dynamic import + callbacks; buildPdfFromPages moved to triggerExtractionFromScan; removeScanPage simplified to cache clear
- `sw.js` — v28 cache, 3 new STATIC entries, Tesseract CDN comment removed
- `app/imaging/reviewScreen.js` — DELETED (orphaned, 324 lines removed)

## Decisions Made

- Dynamic import for live-scanner.js rather than static top-level import: aligns with user-gesture timing and avoids loading 304 lines of camera/DOM setup code until the user taps scan
- `onFallback` creates a fresh `<input>` element (not reusing `#cameraInput`) so the fallback can be triggered repeatedly across multiple openCamera calls
- `buildPdfFromPages` deferred to `triggerExtractionFromScan` — this is the correct fix for the O(N^2) issue where N-page sessions previously assembled 1+2+3+...+N pages total
- `removeScanPage` simplified to clear-only pattern — rebuilding PDF on every removal was unnecessary overhead, the assembled PDF was immediately stale anyway

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored scanZone HTML after successful fallback capture**
- **Found during:** Task 1
- **Issue:** The original `handleCameraCapture` only restored `zone.innerHTML` in the catch block. After a successful capture the zone remained in spinner state ("Processing…") indefinitely
- **Fix:** Added `zone.innerHTML = origHTML; zone.style.pointerEvents = '';` in the try block after processAndRelease completes
- **Files modified:** app/views/upload.js
- **Commit:** f096454

## Issues Encountered

None — both tasks executed cleanly. All 139 tests pass.

## User Setup Required

None.

## Next Phase Readiness

- Phase 9 (Live Camera Document Scanner) is now complete — all 3 plans executed
- End-to-end flow: tap scan zone → openLiveScanner viewfinder opens → capture pages → Done → buildPdfFromPages (once) → Claude extraction
- Fallback path: getUserMedia denied → toast → native input capture → same extraction flow
- Service worker v28 caches all new imaging modules for offline use

---
*Phase: 09-live-camera-document-scanner*
*Completed: 2026-03-30*

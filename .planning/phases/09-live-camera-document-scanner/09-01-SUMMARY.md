---
phase: 09-live-camera-document-scanner
plan: 01
subsystem: imaging
tags: [scanner, web-worker, pure-math, hough-transform, canvas]

# Dependency graph
requires:
  - phase: 02-scanner-and-ocr
    provides: scanner.js with Hough Transform, perspective warp, adaptive threshold
provides:
  - scanner-core.js pure math module (zero DOM, Worker/Node importable)
  - detect-worker.js Web Worker with transferable ArrayBuffer protocol
  - scanner-core.test.js 6 passing unit tests
  - scanner.js refactored to re-export scanner-core + DOM wrappers only
  - ocrBlob dead code removed from processAndRelease
affects: [09-02-detect-worker-integration, 09-03-live-scanner-viewfinder, 09-04-upload-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DOM/pure-math split: scanner-core.js exports zero-DOM functions, scanner.js wraps DOM layer"
    - "Re-export pattern: scanner.js uses export * from scanner-core.js for backward compatibility"
    - "Transferable ArrayBuffer protocol for Worker pixel data (avoids structured clone overhead)"
    - "node:test built-in test runner for zero-dependency unit tests"

key-files:
  created:
    - app/imaging/scanner-core.js
    - app/imaging/detect-worker.js
    - app/imaging/scanner-core.test.js
  modified:
    - app/imaging/scanner.js
    - package.json

key-decisions:
  - "scanner-core.js exports adj3, mul3, mul3v, basisToPoints, createProjector as named exports (previously private) — needed by detect-worker.js and future live-scanner.js"
  - "processImage no longer returns corrected canvas — ocrBlob computation removed means corrected is unused, simplifying return to {scanned} only"
  - "package.json type:module added to eliminate Node.js ES module reparsing warning during tests"

patterns-established:
  - "Pure math isolation: any function that only operates on typed arrays or plain objects belongs in scanner-core.js"
  - "Worker protocol: { rgba: ArrayBuffer (transferable), width, height } → { corners: object|null }"

requirements-completed: [LIVE-01, LIVE-02, LIVE-03]

# Metrics
duration: 5min
completed: 2026-03-30
---

# Phase 9 Plan 01: Scanner Core Extraction Summary

**Hough Transform pure math isolated into scanner-core.js, detect-worker.js Web Worker created, processAndRelease dead ocrBlob computation removed (~2MB saved per captured page)**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-30T01:04:07Z
- **Completed:** 2026-03-30T01:08:34Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Extracted all pure math functions from scanner.js into scanner-core.js (zero DOM dependencies, importable from Node.js and Web Workers)
- Created detect-worker.js implementing the transferable ArrayBuffer message protocol for background edge detection
- Created scanner-core.test.js with 6 passing unit tests (exports check, DOM isolation, detectDocument blank input, adaptive threshold binary output, skew angle accuracy, shoelace area)
- Removed dead ocrBlob computation (~2MB Canvas allocation per captured page that upload.js never used)
- Added `"type": "module"` to package.json to silence Node.js ES module reparsing warning

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract scanner-core.js and refactor scanner.js** - `a6a5b83` (feat)
2. **Task 2: Create detect-worker.js and scanner-core tests** - `68b42d3` (feat)

## Files Created/Modified

- `app/imaging/scanner-core.js` - Pure math module: convolve, grayscale, downscale, gaussianBlur, detectDocument, applyAdaptiveThresholdToArray, computeSkewAngle, shoelaceArea, adj3, mul3, mul3v, basisToPoints, createProjector
- `app/imaging/detect-worker.js` - Web Worker: receives {rgba ArrayBuffer, width, height}, posts back {corners}
- `app/imaging/scanner-core.test.js` - 6 unit tests using node:test, all passing
- `app/imaging/scanner.js` - Refactored: `export * from ./scanner-core.js` + DOM wrappers only, ocrBlob removed
- `package.json` - Added `"type": "module"`

## Decisions Made

- adj3, mul3, mul3v, basisToPoints, createProjector promoted to named exports (were private) — required by detect-worker and future live-scanner.js importers
- processImage simplified to return `{ scanned }` only (corrected canvas was only used for ocrBlob which is now removed)
- package.json `"type": "module"` added as a Rule 3 auto-fix (blocked clean test runs with Node warning)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added type:module to package.json**
- **Found during:** Task 1 (export verification)
- **Issue:** Node.js emitted MODULE_TYPELESS_PACKAGE_JSON warning and re-parsed files as ES modules incurring performance overhead. Test runner output was cluttered.
- **Fix:** Added `"type": "module"` to package.json
- **Files modified:** package.json
- **Verification:** Warning disappeared, node --test runs cleanly
- **Committed in:** a6a5b83 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for clean test execution. No scope creep.

## Issues Encountered

None — plan executed smoothly. The code split was well-defined by RESEARCH.md audit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- scanner-core.js is ready for import in detect-worker.js (done) and live-scanner.js (Plan 02+)
- All existing scanner.js consumers unaffected (re-export preserves backward compatibility)
- detect-worker.js ready to be instantiated by live camera viewfinder in Plan 02+
- Need to add scanner-core.js, detect-worker.js, live-scanner.js to sw.js STATIC cache list (Plan 02+)

---
*Phase: 09-live-camera-document-scanner*
*Completed: 2026-03-30*

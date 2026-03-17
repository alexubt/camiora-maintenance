---
phase: 02-scanner-and-ocr
plan: 01
subsystem: imaging
tags: [canvas, edge-detection, perspective-warp, deskew, adaptive-threshold, jspdf]

requires:
  - phase: 01-foundation
    provides: "Module architecture, upload.js view, service worker caching"
provides:
  - "app/imaging/scanner.js extracted imaging pipeline with deskew"
  - "processImage() with edge detection, perspective warp, deskew, adaptive B&W threshold"
  - "Pure computation functions testable without DOM (computeSkewAngle, applyAdaptiveThresholdToArray)"
  - "jsPDF 4.2.0 loaded from CDN"
affects: [02-scanner-and-ocr, upload-flow]

tech-stack:
  added: [jsPDF 4.2.0]
  patterns: [imaging-pipeline-module, pure-function-extraction-for-testing, coordinate-clamping]

key-files:
  created:
    - app/imaging/scanner.js
    - app/imaging/scanner.test.js
  modified:
    - app/views/upload.js
    - index.html
    - sw.js

key-decisions:
  - "Extracted applyAdaptiveThresholdToArray as pure function for testability (no Canvas/DOM dependency)"
  - "loadImage kept in upload.js (UI-related, creates Image from file blob)"
  - "Deskew re-runs edge detection + corner finding after rotation > 1 degree for accurate warp"

patterns-established:
  - "Imaging functions live in app/imaging/scanner.js, not in view files"
  - "Pure computation functions extracted alongside DOM-dependent wrappers for testability"

requirements-completed: [SCAN-01, SCAN-02, SCAN-04]

duration: 4min
completed: 2026-03-17
---

# Phase 2 Plan 1: Scanner Module Extraction Summary

**Extracted imaging pipeline into scanner.js with deskew rotation, black-corner fix, and jsPDF 4.2.0 upgrade**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-17T04:08:04Z
- **Completed:** 2026-03-17T04:12:15Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Extracted all image processing functions from upload.js into dedicated app/imaging/scanner.js module
- Fixed black-corner bug in perspectiveWarp by clamping coordinates instead of skipping out-of-bounds pixels
- Added computeSkewAngle() and applyRotation() for document deskew, integrated into processImage pipeline
- Upgraded jsPDF from 2.5.2 to 4.2.0 (CVE-2025-68428)
- Created 6 unit tests for pure computation functions, all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scanner.test.js with failing tests (TDD RED)** - `0067aff` (test)
2. **Task 2: Extract scanner module, fix bugs, add deskew, upgrade jsPDF (TDD GREEN)** - `e490c6f` (feat)

## Files Created/Modified
- `app/imaging/scanner.js` - Extracted imaging pipeline with deskew, edge detection, perspective warp, adaptive threshold
- `app/imaging/scanner.test.js` - 6 unit tests for computeSkewAngle and applyAdaptiveThresholdToArray
- `app/views/upload.js` - Removed all image processing functions, imports processImage from scanner.js
- `index.html` - Upgraded jsPDF CDN from 2.5.2 to 4.2.0
- `sw.js` - Bumped cache to v5, added scanner.js to STATIC cache list

## Decisions Made
- Extracted applyAdaptiveThresholdToArray as a pure function (Uint8Array in, Uint8Array out) so threshold logic can be tested without DOM/Canvas
- Kept loadImage() in upload.js since it creates an Image from a file blob (UI-related)
- When deskew rotation is significant (> 1 degree), re-run the full edge detection + corner finding pipeline on the rotated canvas for accurate perspective warp

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected test expectations for uniform dark region**
- **Found during:** Task 1 (writing tests)
- **Issue:** Plan implied uniform dark region (all 30) should return all 0, but adaptive threshold compares each pixel against its local mean minus C. In a uniform region, pixel == mean, so pixel > mean - C is always true, returning 255.
- **Fix:** Updated test to expect 255 for uniform regions (correct behavior of adaptive threshold)
- **Files modified:** app/imaging/scanner.test.js
- **Verification:** Test passes with correct expectation
- **Committed in:** 0067aff (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test spec)
**Impact on plan:** Corrected a misunderstanding in test expectations. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Scanner module extracted and tested, ready for OCR integration (02-02)
- processImage pipeline exports all functions for downstream composition
- jsPDF 4.2.0 loaded and service worker updated

---
*Phase: 02-scanner-and-ocr*
*Completed: 2026-03-17*

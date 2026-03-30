---
phase: 09-live-camera-document-scanner
plan: 02
subsystem: imaging
tags: [live-scanner, getUserMedia, web-worker, canvas, overlay, css]

# Dependency graph
requires:
  - phase: 09-01
    provides: scanner-core.js, detect-worker.js, scanner.js DOM wrappers
provides:
  - app/imaging/live-scanner.js — complete live camera viewfinder module
  - style.css additions — fullscreen scanner layout, overlay, capture button, CSS animations
affects: [09-03-upload-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getUserMedia with facingMode:environment and ideal 1920x1080 constraints"
    - "Transferable ArrayBuffer to detect-worker.js at ~5fps throttle"
    - "requestAnimationFrame overlay loop at 60fps with lerp smoothing (factor 0.15)"
    - "Revoke blob URLs on thumbnail remove and scanner exit to prevent memory leaks"
    - "captureCanvas released (width=0) immediately after toBlob to free GPU memory"

key-files:
  created:
    - app/imaging/live-scanner.js
  modified:
    - style.css

key-decisions:
  - "onFallback() called on getUserMedia unavailable, NotAllowedError, NotFoundError, and Worker construction failure"
  - "displayCorners held for NO_CORNER_FADE_MS (300ms) after currentCorners goes null to avoid flickering"
  - "syncOverlaySize uses offsetWidth/offsetHeight with fallbacks for pre-layout first render"
  - "processImage called on main thread during capture (0.5-2s spinner shown) — acceptable per CONTEXT.md"

requirements-completed: [LIVE-04, LIVE-05, LIVE-06]

# Metrics
duration: 3min
completed: 2026-03-30
---

# Phase 9 Plan 02: Live Scanner Viewfinder Summary

**Live camera viewfinder with getUserMedia, real-time Web Worker edge detection overlay, lerp-smoothed green quad at 60fps, multi-page capture flow, and polished fullscreen CSS**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-30T14:31:39Z
- **Completed:** 2026-03-30T14:34:07Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `app/imaging/live-scanner.js` exporting `openLiveScanner(containerEl, {onDone, onCancel, onFallback})` — a self-contained viewfinder module
- Rear camera opened via getUserMedia with ideal 1920x1080 constraints and `playsinline` for iOS Safari
- Edge detection frames sent to detect-worker.js every ~200ms via transferable ArrayBuffer (avoids structured-clone overhead)
- requestAnimationFrame loop renders smooth lerp-interpolated green quad at 60fps (factor 0.15)
- Capture flow: full-res video frame drawn to canvas, processImage called on main thread, JPEG blob pushed to scannedPages[], canvas released immediately
- Thumbnail strip with per-page remove buttons; Done button enabled only after first capture
- All exit paths (close button, Done button, error/fallback) stop stream tracks and terminate worker
- Flash animation div injected on capture for tactile feedback
- Added 157 lines of scanner CSS to style.css covering all UI components and animations

## Task Commits

Each task was committed atomically:

1. **Task 1: Build live-scanner.js viewfinder module** — `2600f68` (feat)
2. **Task 2: Add live scanner CSS styles** — `823e0bd` (feat)

## Files Created/Modified

- `app/imaging/live-scanner.js` — 304 lines: openLiveScanner, camera startup, worker init, rAF overlay loop, lerp helpers, drawOverlay, sendFrameToWorker, capture flow, thumbnail strip, exit cleanup
- `style.css` — Added `.live-scanner*`, `.capture-flash`, `@keyframes flashFade`, `.live-scanner__spinner` (157 lines appended)

## Decisions Made

- onFallback() is invoked on all camera/worker failure paths (getUserMedia missing, denied, or Worker construction error)
- displayCorners stays visible for 300ms after currentCorners goes null to prevent flicker when document briefly leaves frame
- syncOverlaySize uses offsetWidth with fallback to clientWidth and window.innerWidth for correct first-paint sizing
- processImage runs on the main thread during capture — 0.5-2s delay is acceptable per CONTEXT.md design decision (spinner shown)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — both tasks executed cleanly.

## User Setup Required

None.

## Next Phase Readiness

- live-scanner.js is ready to be wired into upload.js (Plan 03)
- Need to add scanner-core.js, detect-worker.js, live-scanner.js to sw.js STATIC cache (Plan 03 or separate task)
- upload.js currently uses native `<input capture="environment">` — Plan 03 will replace with openLiveScanner call

---
*Phase: 09-live-camera-document-scanner*
*Completed: 2026-03-30*

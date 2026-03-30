# Phase 9: Live Camera Document Scanner - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** PRD Express Path (live-camera-document-scanner.md)

<domain>
## Phase Boundary

Replace the native camera launch with an in-app live camera viewfinder using getUserMedia. Real-time edge detection runs in a Web Worker at 3-5fps using the existing Hough Transform, with a smoothly interpolated green quad overlay at 60fps on the main thread. User taps to capture when edges are detected, scans multiple pages, then presses "Done - Extract" to assemble a multi-page PDF and send it to Claude for extraction in one API call. Also fix dead ocrBlob computation and O(N²) PDF rebuild.

</domain>

<decisions>
## Implementation Decisions

### Web Worker Architecture
- Extract pure math functions from `scanner.js` into `scanner-core.js` (no DOM dependencies)
- `scanner.js` re-exports from `scanner-core.js` and adds DOM wrappers (processImage, processAndRelease, loadImage)
- `detect-worker.js` — Web Worker imports `scanner-core.js`, receives raw pixel data via transferable ArrayBuffer, returns corner coordinates
- Main thread sends frames every ~200ms, skips if worker is busy
- Worker runs detectDocument at 3-5fps on downscaled frames (~360px)
- No OffscreenCanvas (not available on iOS Safari Workers) — use transferable ImageData instead

### Camera Setup
- getUserMedia with `facingMode: 'environment'`, `width: { ideal: 1920 }`, `height: { ideal: 1080 }`, continuous autofocus
- `<video>` element with `playsinline` attribute (required for iOS Safari)
- Video fills viewport with `object-fit: cover`
- On capture: draw video to canvas at full stream resolution (videoWidth × videoHeight)

### Overlay Rendering (Main Thread, 60fps)
- Transparent `<canvas>` positioned absolute over the `<video>` element
- requestAnimationFrame loop draws the detected quad
- Lerp/interpolate between old and new corner positions for smooth transitions
- Green quad: semi-transparent fill (rgba 34,197,94,0.15) + solid stroke (#22c55e, 3px) + corner dots (8px radius)
- No overlay when no document detected

### Capture Flow
1. User taps capture → freeze video frame (pause stream or draw last frame)
2. Draw video to high-res canvas (full stream resolution)
3. Run `processImage` on main thread (one-shot, show spinner — acceptable 0.5-2s delay)
4. `scannedBlob` pushed to `state.scanPages[]`
5. Thumbnail added to bottom strip
6. Resume video feed for next page
7. "Done - Extract" → `buildPdfFromPages()` → Claude extraction (single API call)

### Viewfinder UI Layout
- Video fills viewport
- Transparent overlay canvas (same size, absolute positioned)
- Bottom bar: thumbnail strip of captured pages + "Done - Extract" button
- Capture button (large, centered) or tap-on-quad
- Flash animation on capture for feedback
- Close/back button to exit scanner

### Module Structure
- `app/imaging/scanner-core.js` — pure math (detectDocument, perspectiveWarp, applyAdaptiveThreshold, helpers)
- `app/imaging/scanner.js` — re-exports scanner-core + DOM wrappers
- `app/imaging/detect-worker.js` — Web Worker for background detection
- `app/imaging/live-scanner.js` — viewfinder UI (getUserMedia, video, overlay, capture, thumbnails)
- `app/views/upload.js` — modified to import live-scanner instead of native camera input

### Existing Code Fixes (included in this phase)
- Remove dead `ocrBlob` computation from `processAndRelease` — upload.js discards it, Claude reads the PDF
- Fix O(N²) `buildPdfFromPages` — defer full PDF assembly to "Done" instead of rebuilding after every page
- Remove or repurpose orphaned `reviewScreen.js`

### iOS Safari Compatibility
- `playsinline` on `<video>` (prevents fullscreen takeover)
- No OffscreenCanvas in Web Workers — use transferable ImageData
- getUserMedia requires HTTPS + user gesture (PWA is on GitHub Pages HTTPS)
- iOS may limit camera resolution — test with `ideal: 1920`, accept whatever is returned
- Canvas 2D filters (grayscale, contrast) supported on iOS 15+; older versions need manual pixel manipulation fallback

### Fallback Strategy
- If `getUserMedia` denied or unavailable: fall back to `<input capture="environment">` seamlessly
- Detect with `navigator.mediaDevices?.getUserMedia` capability check
- Toast: "Camera access needed for live scanner — using photo mode"

### Claude's Discretion
- Exact throttle interval for worker frames (200ms suggested, may need tuning)
- Lerp smoothing factor for overlay interpolation
- Whether to show a post-capture corner adjustment step (reuse reviewScreen.js drag handles)
- Flash animation implementation details
- How to handle low-light or blurry conditions (ignore? show warning?)
- Memory management for long multi-page sessions (revoke blob URLs, release bitmaps)

</decisions>

<specifics>
## Specific Ideas

### Performance Budget
- Overlay rendering: <2ms per frame (just drawing 4 lines + fill)
- Detection in worker: 75-225ms per call (3-5fps)
- Main thread stays at 60fps — never blocked by detection
- Capture + processImage: 0.5-2s one-shot (spinner acceptable)

### Camera Constraints
```javascript
{
  video: {
    facingMode: 'environment',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    focusMode: 'continuous',
  },
  audio: false,
}
```

### Worker Message Protocol
```
Main → Worker: { rgba: ArrayBuffer (transferable), width, height }
Worker → Main: { corners: {tl,tr,br,bl} | null }
```

### Service Worker Cache
Add new files to `sw.js` STATIC list:
- `./app/imaging/scanner-core.js`
- `./app/imaging/detect-worker.js`
- `./app/imaging/live-scanner.js`

</specifics>

<deferred>
## Deferred Ideas

None — this phase ships the complete live scanner with all fixes.

</deferred>

---

*Phase: 09-live-camera-document-scanner*
*Context gathered: 2026-03-27 via PRD Express Path*

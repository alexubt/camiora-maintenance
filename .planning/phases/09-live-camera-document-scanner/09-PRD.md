---
created: 2026-03-27T21:30:00.000Z
title: Live Camera Document Scanner
priority: should-have
effort: large
status: captured
beneficiary: fleet manager
tags: [UX, mobile, imaging]
related:
  - 2026-03-26-advanced-ocr-invoice-intelligence.md
  - 2026-03-26-claude-vision-invoice-extraction-architecture.md
---

## Problem
The current scanning flow launches the native camera app, takes a photo, returns to the PWA, then processes the image. This feels disjointed — the user can't see if the document edges are detected before capturing. Photo quality varies because there's no guidance during capture. Native scanner apps (CamScanner, Adobe Scan) provide a much better experience with live edge detection.

## Description
Replace the native camera launch with an in-app live camera view using getUserMedia. The camera feed runs through the existing Hough Transform edge detection (scanner.js) in real-time via a Web Worker, showing a highlighted overlay when document edges are found. User taps to capture when the overlay looks right. After capture, perspective correction and B&W filter are applied automatically. User keeps scanning pages in this flow — each captured page is added as a thumbnail. When done, user presses "Done - Extract" which assembles the multi-page PDF via jsPDF and sends it to Claude for extraction in a single API call.

## Architecture

### Performance Analysis (from codebase exploration)

The existing `detectDocument` in scanner.js **cannot run at 15fps on the main thread**. At 384x216 working resolution:

| Step | Operations | Time estimate (phone) |
|------|-----------|----------------------|
| Grayscale | 83K muls | ~2ms |
| Area-average downscale | ~83K pixels | ~3ms |
| Gaussian 5x5 convolve | 2M muls | ~15ms |
| **Sobel + Hough voting** | **5.4M ops** | **50-200ms** |
| Line NMS + quad enum | 160K | ~5ms |
| **Total** | | **~75-225ms per frame** |

At best, this gives **4-13fps** on a high-end phone, less on mid-range. The Hough voting inner loop is the bottleneck — each edge pixel votes into 65 accumulator cells.

### Solution: Web Worker + Throttled Detection

```
Main Thread                          Web Worker
─────────────                        ──────────
<video> → canvas
requestAnimationFrame loop:
  1. Draw video frame to canvas
  2. Render quad overlay (smooth)
  3. Every 200ms: getImageData →  →  receive pixels
     (skip if worker busy)           detectDocument()
                                     return corners  →  → store corners
  4. On tap: full-res capture
     processImage (main thread)
```

**Key decisions:**
- **Web Worker** for detectDocument — keeps UI at 60fps while detection runs at ~3-5fps in background
- **Throttle to ~200ms** between detection calls — don't flood the worker
- **Smooth overlay interpolation** — lerp between old and new corner positions so the green quad doesn't jump
- **Canvas overlay on top of video** — draw the detected quad on a transparent canvas positioned over the `<video>` element
- **Full-res capture on tap** — grab `<video>` frame at max resolution, run `processImage` on main thread (one-shot, acceptable delay with spinner)

### Camera Setup

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: 'environment',       // rear camera
    width: { ideal: 1920 },          // 1080p for viewfinder
    height: { ideal: 1080 },
    focusMode: 'continuous',
  },
  audio: false,
});
```

For capture, request a higher resolution frame:
- Use `<video>.videoWidth/videoHeight` to get the actual stream resolution
- Draw the video to a canvas at full stream resolution for the capture frame
- Process with existing `processImage` pipeline

### Web Worker Design

New file: `app/imaging/detect-worker.js`

The worker receives raw pixel data and returns detected corners:

```javascript
// detect-worker.js
import { detectDocument } from './scanner-core.js';

self.onmessage = ({ data }) => {
  const { rgba, width, height } = data;
  const corners = detectDocument(new Uint8Array(rgba), width, height);
  self.postMessage({ corners });
};
```

**Refactor needed:** Extract the pure math functions from `scanner.js` into a `scanner-core.js` that has no DOM dependencies (no canvas, no ctx, no Image). The worker imports `scanner-core.js`. The main thread `scanner.js` re-exports from `scanner-core.js` and adds the DOM-dependent functions (processImage, processAndRelease).

### Viewfinder UI

```
┌─────────────────────────────────┐
│                                 │
│        [Live camera feed]       │
│                                 │
│    ┌───────────────────────┐    │
│    │  Green quad overlay   │    │
│    │  (document detected)  │    │
│    └───────────────────────┘    │
│                                 │
├─────────────────────────────────┤
│  📸 Tap to capture              │
│  ┌──┐ ┌──┐ ┌──┐        [Done]  │
│  │p1│ │p2│ │p3│  + Add          │
│  └──┘ └──┘ └──┘                 │
└─────────────────────────────────┘
```

- Video element fills the viewport (object-fit: cover)
- Transparent canvas overlay for the green quad (position: absolute, same size)
- Bottom bar: thumbnail strip of captured pages + "Done - Extract" button
- Capture button or tap on the quad to capture
- Flash animation on capture for feedback

### Overlay Rendering (main thread, 60fps)

```javascript
function renderOverlay(ctx, corners, prevCorners, t) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!corners) return;

  // Lerp corners for smooth transitions
  const c = corners.map((p, i) => ({
    x: prevCorners[i].x + (p.x - prevCorners[i].x) * t,
    y: prevCorners[i].y + (p.y - prevCorners[i].y) * t,
  }));

  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();

  // Semi-transparent green fill + solid green stroke
  ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
  ctx.fill();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Corner dots
  for (const p of c) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
  }
}
```

### Capture Flow

1. User taps capture → freeze the video frame
2. Draw video to a high-res canvas (full stream resolution)
3. Run `processImage` on the frozen frame (main thread, one-shot — show spinner)
4. `scannedBlob` pushed to `state.scanPages[]`
5. Thumbnail added to bottom strip
6. Resume video feed for next page
7. When "Done - Extract" tapped → `buildPdfFromPages()` → Claude extraction

### Module Structure

| File | Purpose |
|------|---------|
| `app/imaging/scanner-core.js` | Pure math: detectDocument, perspectiveWarp, applyAdaptiveThreshold (no DOM) |
| `app/imaging/scanner.js` | Re-exports scanner-core + DOM wrappers: processImage, processAndRelease, loadImage |
| `app/imaging/detect-worker.js` | Web Worker that imports scanner-core and runs detectDocument |
| `app/imaging/live-scanner.js` | Viewfinder UI: getUserMedia, video element, overlay canvas, capture, thumbnail strip |
| `app/views/upload.js` | Modified: imports live-scanner instead of native camera input |

### Existing Code Issues Found

1. **Dead ocrBlob computation** — `processAndRelease` computes `ocrBlob` but upload.js discards it. Now that we use Claude Vision (sends the assembled PDF), the ocrBlob path should be removed entirely.

2. **O(N²) PDF rebuild** — `buildPdfFromPages` re-encodes ALL pages every time a new page is added. Should only encode the new page and append to existing PDF (or defer assembly to "Done").

3. **reviewScreen.js is orphaned** — fully implemented corner-drag UI that's never called. The live scanner replaces this need, but the corner adjustment could be reused as a post-capture review step.

### iOS Considerations

- `getUserMedia` requires HTTPS and user gesture (the PWA is on HTTPS via GitHub Pages)
- iOS Safari requires `playsinline` attribute on `<video>` to prevent fullscreen
- iOS may limit camera resolution via getUserMedia — test with `{ ideal: 1920 }` and fall back
- `OffscreenCanvas` is NOT available in iOS Safari Web Workers — must use `transferable ImageData` instead
- iOS 15+ supports Canvas 2D filters; older versions need fallback for grayscale/contrast

### Fallback Strategy

If `getUserMedia` is denied or unavailable:
- Fall back to current `<input capture="environment">` flow seamlessly
- Detect with `navigator.mediaDevices?.getUserMedia` check
- Show a brief toast: "Camera access needed for live scanner — using photo mode"

## Requests
- Web Worker for off-main-thread edge detection at 3-5fps
- getUserMedia live camera feed with rear camera preference
- Canvas overlay with smoothly interpolated green quad
- Tap-to-capture with auto perspective correction
- Multi-page thumbnail strip in viewfinder
- "Done - Extract" button triggers PDF assembly + Claude extraction
- Refactor scanner.js into DOM-free scanner-core.js + DOM wrapper
- Remove dead ocrBlob computation from processAndRelease
- Fix O(N²) PDF rebuild in buildPdfFromPages
- iOS Safari compatibility (playsinline, no OffscreenCanvas in workers)
- Fallback to native camera if getUserMedia denied

## Deliverables
- `app/imaging/scanner-core.js` — DOM-free pure math module
- `app/imaging/detect-worker.js` — Web Worker for background detection
- `app/imaging/live-scanner.js` — Live viewfinder with overlay and capture
- Modified `app/views/upload.js` — integrated live scanner flow
- Cleaned up `processAndRelease` (no dead ocrBlob)
- Efficient PDF assembly (no N² rebuild)
- Fallback to native camera
- Works on iOS Safari 15+ and Android Chrome

## Dependencies
- Existing Hough Transform pipeline in `app/imaging/scanner.js` (to be refactored into scanner-core.js)
- Existing jsPDF multi-page assembly (buildPdfFromPages in upload.js)
- Existing Claude extraction pipeline (triggers after Done)
- getUserMedia browser API
- Web Workers API

## Notes
Reference: [101arrowz scanner series](https://dev.to/101arrowz/series/15877) — the same series used to build the current Hough Transform.

Key insight from codebase exploration: the current detectDocument already downscales to ~360px internally, which is what we'd send to the Web Worker. The bottleneck is the Hough voting loop (5.4M ops per frame at that resolution), giving ~4-13fps on phones — acceptable for background detection with smooth overlay interpolation filling the gaps.

The reviewScreen.js module (corner drag handles, filter picker) is fully implemented but orphaned. Consider reusing its corner adjustment UX as an optional post-capture review step if the auto-detected corners look wrong.

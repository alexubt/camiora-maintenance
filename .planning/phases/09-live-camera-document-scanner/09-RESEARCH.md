# Phase 9: Live Camera Document Scanner - Research

**Researched:** 2026-03-30
**Domain:** getUserMedia camera API, Web Workers, Canvas 2D, real-time image processing, PWA scanner UX
**Confidence:** HIGH (architecture, code split, APIs) / MEDIUM (iOS edge cases)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Extract pure math functions from `scanner.js` into `scanner-core.js` (no DOM dependencies)
- `scanner.js` re-exports from `scanner-core.js` and adds DOM wrappers (processImage, processAndRelease, loadImage)
- `detect-worker.js` — Web Worker imports `scanner-core.js`, receives raw pixel data via transferable ArrayBuffer, returns corner coordinates
- Main thread sends frames every ~200ms, skips if worker is busy
- Worker runs detectDocument at 3-5fps on downscaled frames (~360px)
- No OffscreenCanvas (not available on iOS Safari Workers) — use transferable ImageData instead
- getUserMedia with `facingMode: 'environment'`, `width: { ideal: 1920 }`, `height: { ideal: 1080 }`, continuous autofocus
- `<video>` element with `playsinline` attribute (required for iOS Safari)
- Video fills viewport with `object-fit: cover`
- On capture: draw video to canvas at full stream resolution (videoWidth × videoHeight)
- Transparent `<canvas>` positioned absolute over the `<video>` element
- requestAnimationFrame loop draws the detected quad
- Lerp/interpolate between old and new corner positions for smooth transitions
- Green quad: semi-transparent fill (rgba 34,197,94,0.15) + solid stroke (#22c55e, 3px) + corner dots (8px radius)
- No overlay when no document detected
- Capture flow: freeze → high-res canvas → processImage → push scannedBlob to state.scanPages → thumbnail strip → resume feed
- "Done - Extract" → buildPdfFromPages() → Claude extraction (single API call)
- Module structure: scanner-core.js, scanner.js (re-export), detect-worker.js, live-scanner.js, modified upload.js
- Remove dead `ocrBlob` computation from `processAndRelease`
- Fix O(N²) `buildPdfFromPages` — defer full PDF assembly to "Done"
- Remove or repurpose orphaned `reviewScreen.js`
- Fallback: if getUserMedia denied/unavailable, fall back to `<input capture="environment">` seamlessly
- iOS: playsinline, no OffscreenCanvas, HTTPS required, `ideal: 1920` accepted as best-effort
- Canvas 2D filters (grayscale, contrast) supported on iOS 15+; older versions need manual pixel manipulation fallback
- Add new files to sw.js STATIC list: scanner-core.js, detect-worker.js, live-scanner.js

### Claude's Discretion
- Exact throttle interval for worker frames (200ms suggested, may need tuning)
- Lerp smoothing factor for overlay interpolation
- Whether to show a post-capture corner adjustment step (reuse reviewScreen.js drag handles)
- Flash animation implementation details
- How to handle low-light or blurry conditions (ignore? show warning?)
- Memory management for long multi-page sessions (revoke blob URLs, release bitmaps)

### Deferred Ideas (OUT OF SCOPE)
None — this phase ships the complete live scanner with all fixes.
</user_constraints>

---

## Summary

Phase 9 replaces the native `<input capture="environment">` camera flow with an in-app `getUserMedia` viewfinder that provides real-time document edge detection and overlay. The work has three distinct concerns: (1) refactoring `scanner.js` to separate pure math from DOM, (2) building the live camera UI module (`live-scanner.js`), and (3) fixing two existing bugs (`ocrBlob` dead computation and O(N²) PDF rebuild).

The scanner.js refactor is straightforward — a code audit shows exactly which functions are DOM-free and which are DOM-dependent. The Web Worker architecture is well-supported in modern browsers including iOS Safari 16+. The main technical risk is iOS-specific getUserMedia behaviour (constraints partially ignored, resolution limits) and iOS Safari throttling requestAnimationFrame to 30fps in low-power mode.

The O(N²) `buildPdfFromPages` fix is simple: stop calling `buildPdfFromPages()` after every page capture and only call it once on "Done - Extract". The `ocrBlob` removal is safe — upload.js discards the return value and uses only `scannedBlob`.

**Primary recommendation:** Split scanner.js first (wave 1), build detect-worker.js (wave 2), build live-scanner.js viewfinder (wave 3), wire upload.js + fix bugs (wave 4), update service worker (wave 5).

---

## Scanner.js Code Audit: DOM vs Pure-Math Split

This is the most critical pre-planning finding. Here is the exact split determined by reading the source:

### Pure Math — Goes to `scanner-core.js` (no DOM, no Canvas, no Image)

| Function | Lines | Notes |
|----------|-------|-------|
| `convolve` | 16-33 | Float32Array math only |
| `grayscale` | 37-45 | Float32Array math only |
| `downscale` | 49-91 | Float32Array math only |
| `gaussianBlur` | 103-105 | Delegates to convolve |
| `gaussianKernel` (const) | 95-101 | Static data — stays with gaussianBlur |
| `_cos`, `_sin` trig tables | 109-116 | Static data — stays with detectDocument |
| `detectDocument` | 133-366 | Pure — takes `Uint8ClampedArray rgba`, returns corners object or null. No DOM at all. |
| `sortQuad` (private) | 371-387 | Helper for detectDocument |
| `adj3`, `mul3`, `mul3v`, `basisToPoints`, `createProjector` | 392-428 | Pure matrix math |
| `applyAdaptiveThresholdToArray` | 490-511 | Takes plain array, returns Uint8Array — pure |
| `computeSkewAngle` | 631-635 | Pure math helper |
| `shoelaceArea` | 637-644 | Pure math helper |

### DOM-Dependent — Stays in `scanner.js` (wrapper layer)

| Function | Lines | Why DOM |
|----------|-------|---------|
| `perspectiveWarp` | 437-486 | `document.createElement('canvas')`, calls `getContext('2d')`, `getImageData`, `putImageData` |
| `applyAdaptiveThreshold` | 513-534 | `canvas.getContext('2d')`, `getImageData`, `putImageData` |
| `loadImage` | 538-545 | `new Image()`, `URL.createObjectURL` |
| `processAndRelease` | 549-575 | Calls processImage (DOM), `canvas.toBlob`, `document.createElement('canvas')` |
| `processImage` | 579-610 | `document.createElement('canvas')`, drawImage, getImageData |
| `detectEdges` | 614-627 | `document.createElement('canvas')`, drawImage, getImageData |

**KEY INSIGHT for the worker:** `detectDocument` is already pure — it takes a `Uint8ClampedArray` and returns a plain object. The worker only needs this one function plus its helpers (grayscale, downscale, gaussianBlur, convolve). No canvas interaction required in the worker at all.

### Exact scanner-core.js exports list

```javascript
// scanner-core.js exports:
export { convolve, grayscale, downscale, gaussianBlur };
export { detectDocument };
export { applyAdaptiveThresholdToArray };
export { computeSkewAngle, shoelaceArea };
// Also exports the matrix math helpers used by perspectiveWarp:
export { adj3, mul3, mul3v, basisToPoints, createProjector };
```

`scanner.js` becomes:
```javascript
export * from './scanner-core.js';
// Then adds: perspectiveWarp, applyAdaptiveThreshold, loadImage,
//            processImage, processAndRelease, detectEdges
```

---

## Web Worker: ES Modules and Transferable Pattern

### Browser Support for `{ type: 'module' }` Workers

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome/Edge | v80+ | Full support |
| Firefox | v114+ | Full support |
| Safari / iOS Safari | iOS 16+ | Supported in dedicated workers |
| iOS 15 and below | No module worker | Fallback needed or use importScripts() |

**Decision (from CONTEXT.md):** Use `new Worker('./app/imaging/detect-worker.js', { type: 'module' })`. This works for iOS 16+. iOS 15 is approximately 3% of global traffic as of 2025.

**Fallback consideration (Claude's discretion):** Since the project targets modern browsers and is a PWA, `type: 'module'` workers are acceptable. A graceful degradation path: if the Worker constructor throws, fall back to input-based capture.

### Transferable ArrayBuffer Protocol

The worker receives raw pixel data as a transferred `ArrayBuffer` (zero-copy). The `ImageData.data` property is a `Uint8ClampedArray` — its underlying buffer can be transferred.

```javascript
// Main thread — sending a frame to the worker
const imageData = ctx.getImageData(0, 0, w, h);
const buffer = imageData.data.buffer; // ArrayBuffer
worker.postMessage({ rgba: buffer, width: w, height: h }, [buffer]);
// After transfer: imageData.data.buffer is detached (neutered) — don't use it again

// Worker — receiving
self.onmessage = ({ data: { rgba, width, height } }) => {
  const pixels = new Uint8ClampedArray(rgba); // wrap received buffer
  const corners = detectDocument(pixels, width, height);
  self.postMessage({ corners }); // corners is a plain object, no transfer needed
};
```

**CRITICAL:** After transferring `buffer` to the worker, the `Uint8ClampedArray` view on the main thread is detached. The getImageData call must happen fresh each time — do not re-use the same ImageData object across frames.

**Performance note:** For a 360px-wide frame at ~640×360 = 230,400 pixels × 4 bytes = ~900KB, transfer time is effectively zero (pointer move). For full 1920×1080 frames this would be ~8MB — but the worker only needs the downscaled frame. Pre-downscale on main thread before sending (or send full frame and let worker downscale — detectDocument already does its own downscaling, so sending full frame is fine given transfer is zero-copy).

---

## getUserMedia: Camera Setup

### Verified constraints for this project

```javascript
const constraints = {
  video: {
    facingMode: { ideal: 'environment' },  // use ideal not exact — exact throws on front-only cameras
    width:  { ideal: 1920 },
    height: { ideal: 1080 },
    // focusMode not a standard constraint — use advanced[] for applyConstraints after stream starts
  },
  audio: false,
};
```

**iOS Safari quirk — facingMode:** Use `{ ideal: 'environment' }` not `{ exact: 'environment' }`. Using `exact` causes `OverconstrainedError` on some iOS devices. `ideal` gracefully falls back to whatever camera is available.

**iOS Safari quirk — resolution:** `width/height ideal` hints are respected on iOS 15+ but may be silently capped. Actual resolution is always read from `videoTrack.getSettings()` after stream starts — never assume the requested resolution was granted.

**Video element requirements (iOS critical):**
```html
<video
  id="liveVideo"
  autoplay
  muted
  playsinline
  style="width:100%;height:100%;object-fit:cover;"
></video>
```
- `playsinline` — prevents iOS Safari from going fullscreen
- `muted` — required for autoplay without user gesture in most browsers
- `autoplay` — stream starts playing once `srcObject` is assigned

**Stream setup pattern:**
```javascript
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return fallbackToInputCapture();
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();
    // Read actual resolution after play:
    // videoEl.videoWidth, videoEl.videoHeight
  } catch (err) {
    // NotAllowedError: user denied, NotFoundError: no camera
    fallbackToInputCapture();
  }
}

function stopCamera(stream) {
  stream.getTracks().forEach(t => t.stop()); // releases camera hardware
}
```

**Capture frame pattern:**
```javascript
function captureFrame() {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  return canvas; // full-res capture
}
```

---

## Overlay: requestAnimationFrame + Throttled Worker Pattern

### The Core Pattern (validated against established patterns)

```javascript
// State
let currentCorners = null;   // corners returned by last worker message
let displayCorners = null;   // interpolated corners for smooth display
let workerBusy = false;
let lastFrameSent = 0;
const THROTTLE_MS = 200;     // 3-5fps detection

// rAF loop (60fps, main thread only)
function overlayLoop(timestamp) {
  if (!scannerActive) return;

  // 1. Throttle: send a new frame to worker every THROTTLE_MS
  if (!workerBusy && timestamp - lastFrameSent > THROTTLE_MS) {
    sendFrameToWorker();
    lastFrameSent = timestamp;
  }

  // 2. Interpolate displayCorners toward currentCorners (lerp)
  if (currentCorners) {
    displayCorners = lerpCorners(displayCorners || currentCorners, currentCorners, 0.15);
  } else {
    displayCorners = null;
  }

  // 3. Draw overlay
  drawOverlay(displayCorners);

  requestAnimationFrame(overlayLoop);
}

// Worker response handler
worker.onmessage = ({ data: { corners } }) => {
  currentCorners = corners;  // null = no document detected
  workerBusy = false;
};

// Send frame (with transfer)
function sendFrameToWorker() {
  const tmpCanvas = document.createElement('canvas');
  const scale = Math.min(1, 360 / videoEl.videoWidth); // target ~360px
  tmpCanvas.width = Math.round(videoEl.videoWidth * scale);
  tmpCanvas.height = Math.round(videoEl.videoHeight * scale);
  tmpCanvas.getContext('2d').drawImage(videoEl, 0, 0, tmpCanvas.width, tmpCanvas.height);
  const imageData = tmpCanvas.getContext('2d').getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
  tmpCanvas.width = 0; // release immediately

  workerBusy = true;
  const buffer = imageData.data.buffer;
  worker.postMessage({ rgba: buffer, width: imageData.width, height: imageData.height }, [buffer]);
}
```

**iOS low-power mode:** iOS Safari throttles rAF to 30fps in low-power mode. This is acceptable — the overlay just renders at 30fps instead of 60fps. The worker continues at its own throttled rate regardless.

### Lerp helper

```javascript
function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function lerpCorners(from, to, t) {
  if (!from || !to) return to;
  return {
    tl: lerpPoint(from.tl, to.tl, t),
    tr: lerpPoint(from.tr, to.tr, t),
    br: lerpPoint(from.br, to.br, t),
    bl: lerpPoint(from.bl, to.bl, t),
  };
}
```

### Overlay draw pattern

```javascript
function drawOverlay(corners) {
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!corners) return;

  // Scale corners from video coords to canvas coords
  const sx = overlayCanvas.width / videoEl.videoWidth;
  const sy = overlayCanvas.height / videoEl.videoHeight;
  const pts = [corners.tl, corners.tr, corners.br, corners.bl].map(p => ({
    x: p.x * sx, y: p.y * sy
  }));

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,197,94,0.15)';
  ctx.fill();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Corner dots
  for (const pt of pts) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
  }
}
```

**Overlay canvas sizing:** Match the video element's rendered size (CSS pixels, not stream resolution). Resize overlay canvas on `window.resize` and on `videoEl.onloadedmetadata`.

---

## Bug Fixes

### Bug 1: Dead ocrBlob Computation in processAndRelease

**Current code (scanner.js lines 549-575):**
- Creates a second `ocrCanvas` at 1600px max with grayscale+contrast
- Encodes it to `ocrBlob` (JPEG)
- Returns `{ scannedBlob, ocrBlob }`

**Consumer (upload.js line 404):**
```javascript
const { scannedBlob } = await processAndRelease(img);
```
`ocrBlob` is destructured away — it is never used. Tesseract.js was removed in Phase 8.

**Fix:** Delete lines 558-574 in processAndRelease (the ocrCanvas creation and toBlob call). Change return to `return { scannedBlob }`. Safe — only one call site exists in the codebase and it already discards ocrBlob.

**Memory saving:** Eliminates one full-res canvas allocation + one JPEG encode per captured page.

### Bug 2: O(N²) buildPdfFromPages

**Current behaviour (upload.js lines 488-540):**
- `buildPdfFromPages()` is called after EVERY page capture:
  - In `handleCameraCapture` after each scan (line 407)
  - In `removeScanPage` after each removal (line 475)
  - In `addMorePages` it is NOT called (line 483-486 just calls `openCamera()`)
- For N pages, N PDF rebuilds happen. The Nth rebuild iterates all N pages. Total work: 1+2+...+N = O(N²).

**Fix approach:** Remove the `buildPdfFromPages()` call from `handleCameraCapture` and `removeScanPage`. Only call it once from `triggerExtractionFromScan` ("Done - Extract" button) and rebuild when pages are removed only if a PDF already exists (or skip rebuild — the PDF can be assembled fresh on Done).

**Revised flow:**
```
scanZone click → openCamera() / live-scanner
page captured → state.scanPages.push(blob) → renderScanPages() → (no PDF build)
"Done - Extract" → buildPdfFromPages() → triggerExtractionFromScan()
page removed → state.scanPages.splice() → renderScanPages() → clear any built PDF from files[]
```

**Code change in upload.js:**
- Line 407: remove `await buildPdfFromPages()` from `handleCameraCapture`
- Lines 474-476: in `removeScanPage`, replace `buildPdfFromPages()` with `files = files.filter(f => f.name !== 'scanned-document.pdf'); renderFileList(); updateAll();`
- `triggerExtractionFromScan()` already has the pdfFile lookup — add `await buildPdfFromPages()` before the `files.find(...)` check

---

## reviewScreen.js: Reusability Analysis

`reviewScreen.js` (324 lines, quick-task 2) implements:
- Edge detection on a static image (calls `detectDocument` once)
- Display canvas with image + quad overlay
- Pointer drag for 4 corner handles
- Filter picker (Original / Grayscale / B&W)
- Accept (perspectiveWarp + filter + toBlob) / Retake flow

**What is reusable for live-scanner.js:**

| Component | Reusable? | How |
|-----------|-----------|-----|
| Quad draw code (lines 97-124) | YES — copy directly | Same canvas pattern, same colors (update from #1D9E75 to #22c55e per CONTEXT.md) |
| Corner drag handles (lines 128-168) | YES — if post-capture corner adjustment is enabled | Pointer events + setPointerCapture pattern is solid |
| getCanvasPos() helper (lines 131-138) | YES | Handles rect offset + scale correctly |
| Filter picker (lines 173-225) | Partially | Only needed if filter step is included in live flow |
| Accept/Retake action structure | NO — different flow | Live scanner has thumbnail strip, not static retake |
| ocrCanvas creation in accept handler | NO — dead code per Bug 1 fix | |

**CONTEXT.md says (Claude's discretion):** "Whether to show a post-capture corner adjustment step (reuse reviewScreen.js drag handles)". The draggable corner handle code from lines 141-168 of reviewScreen.js is directly portable.

**Fate of reviewScreen.js:** The file can be left in place (it currently has no import in any active module — it was a quick-task addition). The planner should decide whether to: (a) delete it and inline reused logic, or (b) refactor it to `corner-adjust.js` for optional use. For simplicity, delete it and copy only the corner draw + drag logic needed.

---

## Module Structure and File Contracts

### New files to create

**`app/imaging/scanner-core.js`**
- Pure math exports: `convolve`, `grayscale`, `downscale`, `gaussianBlur`, `detectDocument`, `applyAdaptiveThresholdToArray`, `computeSkewAngle`, `shoelaceArea`, plus private matrix helpers (`adj3`, `mul3`, `mul3v`, `basisToPoints`, `createProjector`) if perspectiveWarp is being split too
- No DOM imports, no Canvas, no Image, no URL API
- Importable from both browser main thread and Worker context

**`app/imaging/detect-worker.js`**
- `import { detectDocument } from './scanner-core.js';`
- `self.onmessage` handler: receives `{ rgba: ArrayBuffer, width, height }`, returns `{ corners: {tl,tr,br,bl}|null }`
- No state between messages

**`app/imaging/live-scanner.js`**
- Exports: `openLiveScanner(containerEl, onDone)` — mounts the scanner UI
- Manages: getUserMedia stream lifecycle, video element, overlay canvas, rAF loop, worker, thumbnail strip
- Imports: `detect-worker.js` (via Worker constructor), `scanner.js` (for processImage in capture path)
- Calls `onDone(scannedBlobs[])` or `onCancel()`

### Modified files

**`app/imaging/scanner.js`**
- `export * from './scanner-core.js'` — re-exports all pure functions (backward compat for tests)
- Adds: `perspectiveWarp`, `applyAdaptiveThreshold`, `loadImage`, `processImage`, `processAndRelease` (with ocrBlob removed), `detectEdges`

**`app/views/upload.js`**
- Replace `openCamera()` / `handleCameraCapture()` with `openLiveScanner()` call
- Fix `buildPdfFromPages` call sites (O(N²) fix)
- Keep fallback to `<input capture>` if getUserMedia unavailable

**`sw.js`**
- Increment CACHE version (currently `camiora-v27` → `camiora-v28`)
- Add to STATIC list:
  - `'./app/imaging/scanner-core.js'`
  - `'./app/imaging/detect-worker.js'`
  - `'./app/imaging/live-scanner.js'`
- Remove `reviewScreen.js` from STATIC list if it was ever added (it was not — safe to ignore)

---

## Architecture Patterns

### Recommended Project Structure (new files only)

```
app/imaging/
├── scanner-core.js     NEW — pure math (detectDocument, helpers)
├── scanner.js          MODIFIED — re-exports core + adds DOM wrappers, ocrBlob removed
├── detect-worker.js    NEW — Web Worker for background detection
├── live-scanner.js     NEW — full viewfinder UI module
└── reviewScreen.js     REMOVE (or leave orphaned — not imported anywhere)
app/views/
└── upload.js           MODIFIED — openCamera→openLiveScanner, buildPdf O(N²) fix
sw.js                   MODIFIED — bump cache version, add 3 new static files
```

### Pattern: Worker Busy-Flag Guard

Never send a new frame if the worker hasn't responded yet. The worker processes one frame at a time — no queue needed.

```javascript
let workerBusy = false;

// Before sending:
if (workerBusy) return;
workerBusy = true;
worker.postMessage(..., [buffer]);

// On worker message:
worker.onmessage = ({ data }) => {
  workerBusy = false;
  currentCorners = data.corners;
};
```

### Pattern: Overlay Canvas Resize Synchronization

The overlay canvas must match the video element's rendered CSS size, not the stream resolution.

```javascript
function syncOverlaySize() {
  overlayCanvas.width = videoEl.offsetWidth;
  overlayCanvas.height = videoEl.offsetHeight;
}

videoEl.addEventListener('loadedmetadata', syncOverlaySize);
window.addEventListener('resize', syncOverlaySize);
```

Corner coordinates from detectDocument are in stream-pixel space. Scale to CSS pixel space when drawing: `x_css = x_stream * (canvas.width / videoEl.videoWidth)`.

### Pattern: Stream Cleanup on Exit

Always stop all tracks when leaving the scanner — failure to do this holds the camera hardware and the OS camera-in-use indicator stays lit.

```javascript
function exitScanner() {
  scannerActive = false;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  worker.terminate();
}
```

### Pattern: Flash Feedback on Capture

A simple CSS class toggle with a short animation is sufficient — no library needed.

```javascript
function flashCapture() {
  const flash = document.createElement('div');
  flash.className = 'capture-flash';
  scannerEl.appendChild(flash);
  setTimeout(() => flash.remove(), 300);
}
```
CSS: `.capture-flash { position:absolute; inset:0; background:#fff; opacity:0.7; animation: flashFade 0.3s ease-out forwards; pointer-events:none; }`.

### Anti-Patterns to Avoid

- **Drawing overlay canvas in worker:** Workers have no `requestAnimationFrame` — keep all canvas drawing on main thread.
- **OffscreenCanvas in Workers on iOS Safari:** Not supported in iOS Safari Workers as of iOS 17. Do not use.
- **Using `exact` constraints for facingMode:** Throws `OverconstrainedError` on front-only or some iOS cameras. Use `ideal`.
- **Calling buildPdfFromPages after every capture:** O(N²) — only call once on "Done".
- **Re-using a detached ArrayBuffer:** After `worker.postMessage(buf, [buf])`, `buf` is neutered. Always create fresh ImageData each frame.
- **Not stopping stream tracks on unmount:** Camera stays active, battery drains, indicator stays lit.
- **Sizing overlay canvas to stream resolution:** Must size to CSS pixel dimensions of the video element, or corner positions will not align visually.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Document edge detection | Custom CV pipeline | `detectDocument` from scanner-core.js | Already implemented, tested, Hough Transform |
| Perspective correction | Affine transform | `perspectiveWarp` from scanner.js | Projective homography already implemented |
| PDF assembly | Custom PDF encoder | jsPDF (already in project, window.jspdf) | Edge cases with compression, metadata |
| Worker module bundling | Build step / rollup | Native ES module Worker `{type:'module'}` | No build step (project constraint) |
| Smooth corner animation | Custom tweening library | Linear interpolation (lerp) in rAF | 4 points × lerp = ~10 lines, no dep needed |

---

## Common Pitfalls

### Pitfall 1: iOS Safari Won't Play Video Without User Gesture
**What goes wrong:** `videoEl.play()` is called programmatically after `srcObject` assignment and throws `NotAllowedError`.
**Why it happens:** iOS Safari requires autoplay to be triggered by a user gesture, EXCEPT when the video is muted.
**How to avoid:** Always set `muted` attribute on the video element. The live scanner does not need audio.
**Warning signs:** `play() failed because the user didn't interact with the document first` console error on iOS.

### Pitfall 2: Overlay Canvas Position Mismatch
**What goes wrong:** Detected corners appear offset — the green quad is displaced from the actual document edges.
**Why it happens:** Corner coordinates are in video stream pixels (e.g., 1920×1080), but the overlay canvas may be sized to CSS pixels (e.g., 390×844 on iPhone). Without scaling, dots appear in wrong position.
**How to avoid:** Always scale: `x_display = x_stream × (overlayCanvas.width / videoEl.videoWidth)`.
**Warning signs:** Quad lines visible but offset from actual document on device.

### Pitfall 3: Worker Module Type Not Supported (iOS 15)
**What goes wrong:** `new Worker(url, { type: 'module' })` throws or silently fails on older iOS.
**Why it happens:** iOS 16+ supports module workers; iOS 15 does not.
**How to avoid:** Wrap Worker construction in try/catch. On error, fall back to `<input capture>` path.
**Warning signs:** No error visible in UI, worker never responds, `workerBusy` stays false but no corners appear.

### Pitfall 4: DetachedArrayBuffer After Transfer
**What goes wrong:** `TypeError: Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer` when trying to use ImageData after posting to worker.
**Why it happens:** Transfer moves the memory — the original view is neutered.
**How to avoid:** Never read `imageData.data` after the postMessage transfer. Create a fresh `getImageData()` each frame.
**Warning signs:** TypeErrors in sendFrameToWorker after the first frame.

### Pitfall 5: Stream Tracks Not Stopped on Navigation
**What goes wrong:** Camera indicator stays on after user leaves the scanner; subsequent calls fail or use wrong camera.
**Why it happens:** `srcObject` tracks keep running until explicitly stopped.
**How to avoid:** Call `stream.getTracks().forEach(t => t.stop())` in all exit paths (back button, Done, error).
**Warning signs:** Camera light stays on after scanner is dismissed; iOS camera permission dialog appears repeatedly.

### Pitfall 6: buildPdfFromPages Called Redundantly During Remove
**What goes wrong (current bug):** Removing page 3 of a 5-page scan triggers `buildPdfFromPages()` which re-assembles 4 pages — this is wasted work because the user may remove more pages.
**How to avoid:** Only build PDF on "Done - Extract" trigger. On page removal, just remove blob from `state.scanPages` and clear any cached PDF file from `files[]`.

---

## Code Examples

### detect-worker.js (complete implementation)

```javascript
// Source: architecture decision in CONTEXT.md + MDN Worker postMessage docs
import { detectDocument } from './scanner-core.js';

self.onmessage = function({ data: { rgba, width, height } }) {
  const pixels = new Uint8ClampedArray(rgba);
  const corners = detectDocument(pixels, width, height);
  self.postMessage({ corners }); // corners is {tl,tr,br,bl}|null
};
```

### Worker construction with fallback

```javascript
// Source: MDN Web Worker API, caniuse.com module worker support data
let detectionWorker = null;
let workerSupported = true;

try {
  detectionWorker = new Worker('./app/imaging/detect-worker.js', { type: 'module' });
  detectionWorker.onmessage = handleWorkerResult;
  detectionWorker.onerror = (e) => { console.error('Worker error', e); workerSupported = false; };
} catch (e) {
  console.warn('Module workers not supported, falling back to input capture');
  workerSupported = false;
}
```

### processAndRelease with ocrBlob removed (fixed version)

```javascript
// After fix — removes dead ocrBlob computation
export async function processAndRelease(img) {
  const { scanned } = processImage(img);
  const scannedBlob = await new Promise(resolve =>
    scanned.toBlob(resolve, 'image/jpeg', 0.85)
  );
  scanned.width = 0;
  scanned.height = 0;
  return { scannedBlob };
}
```

### Live scanner capture flow

```javascript
async function onCapturePress() {
  // 1. Freeze: pause or just draw current frame
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = videoEl.videoWidth;
  captureCanvas.height = videoEl.videoHeight;
  captureCanvas.getContext('2d').drawImage(videoEl, 0, 0);

  // 2. Flash feedback
  flashCapture();

  // 3. Show spinner in thumbnail area
  showCaptureSpinner();

  // 4. Process (0.5-2s, acceptable per CONTEXT.md)
  const fakeImg = { width: captureCanvas.width, height: captureCanvas.height };
  // processImage expects an HTMLImageElement-like drawable — use canvas directly:
  const { scanned, corrected } = processImageFromCanvas(captureCanvas);
  captureCanvas.width = 0;
  corrected.width = 0; // corrected not needed post-Phase-8

  const scannedBlob = await new Promise(resolve =>
    scanned.toBlob(resolve, 'image/jpeg', 0.85)
  );
  scanned.width = 0;

  // 5. Push and render thumbnail
  state.scanPages.push(scannedBlob);
  renderThumbnailStrip();
  hideCaptureSpinner();
}
```

Note: `processImage` currently calls `document.createElement('canvas')` internally and takes an `img` element (or any drawable). Since we have a canvas, we need a small variant `processImageFromCanvas(srcCanvas)` that skips the `drawImage(img)` step — or simply use the existing `processImage` by creating a temporary img from the canvas blob.

---

## Service Worker Cache Update

Current version: `camiora-v27`. Must increment to bust cache.

```javascript
// sw.js — change:
const CACHE = 'camiora-v28';

// Add to STATIC array:
'./app/imaging/scanner-core.js',
'./app/imaging/detect-worker.js',
'./app/imaging/live-scanner.js',
```

**Note:** Service Workers cache their own script. When `sw.js` changes, the browser will detect the byte difference, install the new SW, and skip waiting (`skipWaiting()` is already in place). Incrementing the CACHE name ensures old cached assets are evicted.

**detect-worker.js caching consideration:** The worker file must be cached by the SW for offline use. Since `sw.js` uses cache-first for everything except CDN assets, adding `detect-worker.js` to STATIC is sufficient.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `<input capture="environment">` for camera | getUserMedia in-app viewfinder | Phase 9 | Real-time preview + edge detection |
| processAndRelease returns ocrBlob | processAndRelease returns only scannedBlob | Phase 9 fix | Eliminates ~2MB wasted allocation per page |
| buildPdfFromPages called per capture (O(N²)) | buildPdfFromPages called once on Done | Phase 9 fix | Eliminates N-1 redundant PDF assemblies for N pages |
| Tesseract.js OCR | Claude Vision (Phase 8) | Phase 8 | ocrBlob is now permanently dead code |
| reviewScreen.js (quick-task 2) | Orphaned — logic folded into live-scanner.js | Phase 9 | Removes duplicate corner-draw code |

---

## Open Questions

1. **processImage takes `img` not `canvas` — needs adapter**
   - What we know: `processImage(img)` calls `wCtx.drawImage(img, ...)`. An HTMLCanvasElement is drawable.
   - What's unclear: Is `img.width` / `img.height` read from the element? Canvas has `.width`/`.height` — should work.
   - Recommendation: Test that `processImage(canvas)` works as-is (drawImage accepts canvas). If it does, no adapter needed. Otherwise add `processImageFromCanvas` to scanner-core.js.

2. **Worker path resolution from service worker cache**
   - What we know: Worker is constructed with relative path `'./app/imaging/detect-worker.js'`. The SW caches this path.
   - What's unclear: When the Worker fetches `scanner-core.js` via `import`, the URL resolves relative to the worker script's URL — this should work correctly from GitHub Pages.
   - Recommendation: Verify the import resolves correctly in the deployed environment. No action needed if the SW caches both files.

3. **iOS Safari 15 fallback strategy**
   - What we know: Module workers not supported on iOS 15. ~3% of traffic.
   - What's unclear: Whether to silently degrade to input capture or show a message.
   - Recommendation: Silent degradation — use the existing `<input capture>` path without any user-visible notification (matches the existing fallback strategy in CONTEXT.md).

4. **reviewScreen.js delete vs. keep**
   - What we know: reviewScreen.js is not imported anywhere in the active module graph.
   - Recommendation: Delete the file in this phase. The draggable corner logic will be copied inline into live-scanner.js if the optional post-capture adjustment step is implemented.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (node:test) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test app/imaging/scanner-core.test.js` |
| Full suite command | `node --test` (runs all *.test.js files) |

### Phase Requirements → Test Map

This phase has no formal requirement IDs in REQUIREMENTS.md (Phase 9 is not yet in the requirements table). The testable units are:

| Behavior | Test Type | Automated Command | Notes |
|----------|-----------|-------------------|-------|
| scanner-core.js exports all expected functions | unit | `node --test app/imaging/scanner-core.test.js` | Verify no DOM deps |
| detectDocument returns null on blank pixel array | unit | same | Regression guard |
| applyAdaptiveThresholdToArray pure output | unit | same | Existing test coverage |
| processAndRelease no longer returns ocrBlob | unit | `node --test app/imaging/scanner.test.js` | Verify return shape |
| detect-worker.js message protocol | integration | manual / browser DevTools | Cannot run Node test for Worker |
| buildPdfFromPages not called on page add | unit/manual | manual browser test | DOM-dependent |
| getUserMedia fallback to input capture | manual | iPhone / browser DevTools camera block | Hardware required |

### Sampling Rate
- **Per task commit:** `node --test app/imaging/scanner-core.test.js` (pure math, fast)
- **Per wave merge:** `node --test` (full suite)
- **Phase gate:** Full suite green + manual smoke test on iOS Safari before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `app/imaging/scanner-core.test.js` — covers: exports present, detectDocument null on blank, no DOM reference check
- [ ] Update existing scanner.js tests (if any exist) to import from scanner-core.js

---

## Sources

### Primary (HIGH confidence)
- Direct source code audit: `app/imaging/scanner.js` — function-by-function DOM dependency analysis
- Direct source code audit: `app/views/upload.js` — buildPdfFromPages call sites, ocrBlob usage
- Direct source code audit: `app/imaging/reviewScreen.js` — reusable corner/drag logic
- `app/state.js` — confirmed `scanPages: []` is `Blob[]`
- `sw.js` — current cache version `camiora-v27`, STATIC list
- MDN Web Workers API — transferable objects, postMessage, Worker constructor

### Secondary (MEDIUM confidence)
- [Can I Use — Worker ES Modules](https://caniuse.com/mdn-api_worker_worker_ecmascript_modules) — iOS Safari 16+ support confirmed
- [MDN — Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) — zero-copy transfer pattern
- [MDN — getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — constraints, errors
- WebSearch: iOS Safari `facingMode: exact` throws OverconstrainedError — multiple sources agree
- WebSearch: iOS low-power mode throttles rAF to 30fps — Motion.dev blog + community reports

### Tertiary (LOW confidence — flag for validation)
- iOS 15 module worker non-support — inferred from caniuse data; exact failure mode (throw vs. silent) not verified in current iOS 15 devices
- `focusMode: 'continuous'` as a getUserMedia constraint — not in the standard spec (belongs in `applyConstraints` advanced array); needs browser testing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project (jsPDF, scanner.js Hough Transform, state.js)
- Architecture: HIGH — derived from direct source code audit, no assumptions
- DOM/pure split: HIGH — every function in scanner.js hand-audited
- Bug fixes (ocrBlob, O(N²)): HIGH — traced all call sites in upload.js
- getUserMedia constraints/iOS quirks: MEDIUM — multiple sources agree but iOS behaviour varies by device/OS version
- Web Worker module support: HIGH for iOS 16+, MEDIUM for iOS 15 fallback behaviour

**Research date:** 2026-03-30
**Valid until:** 2026-05-30 (stable APIs — getUserMedia, Canvas 2D, Web Workers are not fast-moving)

# Phase 2: Scanner and OCR - Research

**Researched:** 2026-03-16
**Domain:** Client-side image processing (Canvas API), OCR (Tesseract.js), PDF generation (jsPDF), iOS memory management
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCAN-01 | Image is converted to B&W with high contrast to look like a scanned document | `applyAdaptiveThreshold()` exists in upload.js; needs canvas memory release after processing |
| SCAN-02 | Crooked photos are automatically deskewed/straightened | Current `perspectiveWarp()` does geometric correction; rotation-based deskew needed as complement |
| SCAN-03 | Canvas memory is released after processing to prevent iOS crashes | Current code never calls `canvas.width = 0`; store blobs not canvases in `state.scanPages` |
| SCAN-04 | jsPDF upgraded to 4.2.0 (security fix + better encoding) | One-line CDN change; `addImage()` API is unchanged; CVE-2025-68428 confirmed fixed |
| OCR-01 | Tesseract.js extracts text from scanned invoice image | Tesseract.js v5 CDN pattern confirmed; lazy-load after scan, not on page load |
| OCR-02 | OCR auto-fills unit number, date, and maintenance type from extracted text | Regex extraction from `result.data.text`; pattern matching for truck/trailer IDs, dates, service keywords |
| OCR-03 | User can confirm or correct OCR-detected fields before upload | Non-blocking UI: show OCR suggestions as pre-filled values that remain editable |
</phase_requirements>

---

## Summary

Phase 2 has three distinct workstreams that can be planned mostly independently: (1) hardening the existing scanner pipeline with correct memory management and jsPDF upgrade, (2) improving deskew quality by adding rotation correction alongside the existing perspective warp, and (3) introducing Tesseract.js OCR as a lazy-loaded post-scan step.

The most critical finding is that the existing scanner in `app/views/upload.js` already implements the full B&W pipeline (grayscale, Gaussian blur, Sobel edge detection, perspective warp, adaptive threshold) but has two bugs that must be fixed before anything else: canvas objects are stored permanently in `state.scanPages` instead of being converted to blobs (iOS OOM crash risk), and the perspective warp leaves black corners when source pixels are out of bounds. Both bugs are well-understood and have clear fixes.

Tesseract.js v5 is the right OCR choice. The user already accepted the size tradeoff. At v5, the English trained data is approximately 1.4MB (down from 2.8MB in v4 — 54% reduction), and the WASM core is approximately 1.5MB. Total lazy-load cost is roughly 3MB on first scan after a session. The v5 API is simplified: `createWorker('eng')` is all that is needed — no separate `loadLanguage`/`initialize` calls. The worker runs in a WebWorker, keeping the main thread unblocked during OCR.

The jsPDF upgrade from 2.5.2 to 4.2.0 is a one-line CDN URL change. The `addImage()` call signature is unchanged between 2.x and 4.x for the usage in this codebase.

**Primary recommendation:** Fix canvas memory management and black-corner bugs first, then add rotation deskew, then add OCR as a lazy-loaded module. All work builds on the existing code — no rewrites.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Canvas API | Web built-in | All image processing: grayscale, blur, edge detect, perspective warp, adaptive threshold | Already implemented; sufficient without dependencies |
| jsPDF | 4.2.0 (CDN UMD) | PDF generation from canvas | Fixes CVE-2025-68428; PNG encoding regression fixed in 3.x+; drop-in upgrade |
| Tesseract.js | 5.x latest (CDN) | OCR text extraction from scanned image | User-accepted; v5 iOS-compatible; v5 API simpler than v4 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| perspective-transform (jlouthan) | 1.1.0 | Lightweight homography math if current warp has accuracy issues | Only if bilinear interpolation artifacts are unacceptable after black-corner fix |
| SubtleCrypto (Web built-in) | — | SHA-256 for image hash (dedup detection) | Do not use — unnecessary complexity for this phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tesseract.js 5.x | OpenCV.js OCR | OpenCV has no OCR; wrong tool |
| Tesseract.js 5.x | Tesseract.js 6.x / 7.x | v6/v7 exist but project context specifies v5 size acceptance; v5 is stable and iOS-compatible; stick with `@5` semver range |
| Canvas adaptive threshold | CSS `filter: grayscale contrast` | CSS filter is faster but not bitonal — adaptive threshold produces true B&W scanned appearance |
| Inline OCR on main thread | Web Worker for OCR | Tesseract.js v5 spawns its own internal WebWorker automatically; no separate worker file needed |

### Installation (CDN — no build step)

Update `index.html`:
```html
<!-- Replace existing jsPDF 2.5.2 line -->
<script src="https://cdn.jsdelivr.net/npm/jspdf@4.2.0/dist/jspdf.umd.min.js"></script>
```

Tesseract.js is NOT added to `index.html`. Load it lazily in `app/imaging/ocr.js`:
```javascript
async function ensureTesseract() {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
```

Update `sw.js` CACHE list to include the new jsPDF URL (remove the old 2.5.2 URL). Do NOT pre-cache Tesseract.js — it is ~3MB and will destroy the PWA install time.

---

## Architecture Patterns

### Recommended Project Structure for Phase 2

```
app/
├── imaging/              # NEW - extract from upload.js
│   ├── scanner.js        # processImage(), gaussianBlur(), sobelEdges()
│   │                     #   findDocumentCorners(), perspectiveWarp()
│   │                     #   applyAdaptiveThreshold()
│   │                     # + deskewRotation() (new)
│   │                     # + releaseScanCanvas() (new)
│   └── ocr.js            # ensureTesseract(), runOCR(), parseInvoiceFields()
├── views/
│   └── upload.js         # Remove image processing fns; import from imaging/
└── state.js              # Change scanPages: [] to store blobs, not canvases
```

The imaging/ module is extracted from upload.js, not rewritten. Move the functions verbatim, add the missing canvas release logic and the new rotation deskew function.

### Pattern 1: Canvas Memory Release (SCAN-03)

**What:** Convert processed canvas to a JPEG blob immediately after processing; set canvas dimensions to zero to release GPU memory.

**When to use:** After every call to `processImage()` before storing in `state.scanPages`.

**Example:**
```javascript
// Source: Apple Developer Forums thread/687866 pattern + MDN canvas spec
async function processAndRelease(img) {
  const canvas = processImage(img);         // existing pipeline
  const blob = await canvasToBlob(canvas);  // convert to blob
  canvas.width = 0;                         // release GPU memory
  canvas.height = 0;
  return blob;  // store this, not the canvas
}

function canvasToBlob(canvas) {
  return new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
}
```

In `state.scanPages`, each entry becomes a Blob, not a canvas. Update `renderScanPages()` to call `URL.createObjectURL(blob)` for thumbnails and revoke after render. Update `buildPdfFromPages()` to draw blobs onto temporary canvases (create, use, release immediately).

### Pattern 2: Black Corner Fix in Perspective Warp (SCAN-02 / quality)

**What:** When bilinear interpolation in `perspectiveWarp()` can't find source pixels (out-of-bounds), it currently skips them (leaves pixels at black default). Fix: extend edge pixels to fill gaps instead.

**When to use:** Replace the `continue` at line 482 of upload.js.

**Example:**
```javascript
// Source: .planning/codebase/CONCERNS.md analysis + standard edge-extension pattern
// Replace: if (x0 < 0 || x0 >= srcCanvas.width - 1 || ...) continue;
const cx = Math.max(0, Math.min(srcCanvas.width - 2, x0));
const cy = Math.max(0, Math.min(srcCanvas.height - 2, y0));
// then use cx, cy instead of x0, y0 for pixel lookup
```

### Pattern 3: Rotation Deskew (SCAN-02)

**What:** The existing `perspectiveWarp()` corrects perspective (trapezoid to rectangle) but does not correct pure rotation (a straight-on photo of a rotated document). Add a lightweight rotation detection step using the edge data that `sobelEdges()` already produces.

**When to use:** After `findDocumentCorners()` — use detected corner positions to compute the rotation angle and apply `ctx.rotate()` before the perspective warp.

**Approach — angle from detected quad corners (LOW complexity):**
```javascript
// Source: standard geometry, no library needed
function computeSkewAngle(corners) {
  // Use top edge (tl to tr) to compute horizontal angle
  const dx = corners.tr.x - corners.tl.x;
  const dy = corners.tr.y - corners.tl.y;
  return Math.atan2(dy, dx);  // radians; apply -angle to canvas
}

function applyRotation(canvas, angleRad) {
  if (Math.abs(angleRad) < 0.01) return canvas;  // < 0.6°, skip
  const diag = Math.ceil(Math.hypot(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = diag;
  out.height = diag;
  const ctx = out.getContext('2d');
  ctx.translate(diag / 2, diag / 2);
  ctx.rotate(-angleRad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  canvas.width = 0;  // release source
  return out;
}
```

If corners are not detected (document fills frame, no clear boundary), skip rotation. The perspective warp already handles the common case; rotation correction only activates when corners are found.

### Pattern 4: Tesseract.js OCR Integration (OCR-01, OCR-02, OCR-03)

**What:** After PDF is created, lazily load Tesseract.js, run OCR on the first scan page blob, extract text, parse invoice fields, pre-populate form.

**When to use:** Triggered automatically after `buildPdfFromPages()` completes.

**Example:**
```javascript
// Source: Tesseract.js v5 README + naptha/tesseract.js releases/tag/v5.0.0
// app/imaging/ocr.js

let _worker = null;

export async function runOCR(imageBlob) {
  await ensureTesseract();
  if (!_worker) {
    _worker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      langPath:   'https://cdn.jsdelivr.net/npm/tesseract.js-lang-fast@5.0.0/lang/',
      corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.2',
    });
  }
  const { data: { text } } = await _worker.recognize(imageBlob);
  return parseInvoiceFields(text);
}

export function parseInvoiceFields(text) {
  // Unit number: TR-042, TRK-042, Truck 42, etc.
  const unitMatch = text.match(/\b(?:TR|TRK|TL|TRL)[-\s]?(\d{2,4})\b/i);
  // Date: 2026-03-16, 03/16/2026, March 16 2026
  const dateMatch = text.match(
    /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/
  );
  // Service type keywords
  const svcMap = {
    'oil': 'oil-change', 'tire': 'tire-rotation', 'brake': 'brake-inspection',
    'dot': 'dot-inspection', 'pm service': 'pm-service', 'engine': 'engine-repair',
    'transmission': 'transmission', 'electrical': 'electrical', 'a/c': 'ac-service',
  };
  let serviceType = null;
  const lower = text.toLowerCase();
  for (const [kw, val] of Object.entries(svcMap)) {
    if (lower.includes(kw)) { serviceType = val; break; }
  }

  return {
    unitNumber: unitMatch ? unitMatch[1].padStart(3, '0') : null,
    date: dateMatch ? normalizeDate(dateMatch[1]) : null,
    serviceType,
  };
}
```

**OCR worker lifecycle:** Create the worker once per session (module-level `_worker`). Do not terminate after each scan — reuse for subsequent scans. Terminate on sign-out or navigation away.

**Pre-population UX (OCR-03):** After OCR returns, set form field values only if the field is currently empty. Show a subtle "OCR suggestion" indicator. Never overwrite a value the user has already typed.

```javascript
// In upload.js, after buildPdfFromPages()
const fields = await runOCR(state.scanPages[0]);  // first page blob
if (fields.unitNumber && !document.getElementById('unitNum').value) {
  document.getElementById('unitNum').value = fields.unitNumber;
}
if (fields.date && !document.getElementById('serviceDate').value) {
  document.getElementById('serviceDate').value = fields.date;
}
if (fields.serviceType && !document.getElementById('serviceType').value) {
  document.getElementById('serviceType').value = fields.serviceType;
}
updateAll();
```

### Anti-Patterns to Avoid

- **Storing canvases in state.scanPages:** Causes iOS 224MB OOM crash on 3+ scans. Always convert to blob immediately and release the canvas.
- **Pre-loading Tesseract.js on app start:** 3MB download blocks PWA first-load. Load only after the user's first scan.
- **Blocking the UI during OCR:** Tesseract.js v5 runs in an internal WebWorker; the UI stays responsive. But DO show a "Reading invoice..." progress indicator so the user knows OCR is running.
- **Using `canvas.toDataURL()` for thumbnails on the full-res canvas:** Adds memory pressure. Create a small 80px thumbnail canvas, draw the blob to it, call `toDataURL`, discard the thumbnail canvas.
- **Terminating the Tesseract worker after every scan:** Worker startup downloads WASM (~1.5MB). Reuse the worker across scans in a session.
- **Auto-overwriting user-entered form fields with OCR values:** OCR can misread. Only pre-fill empty fields. Never overwrite what the user typed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OCR text recognition | Custom WASM text extractor | Tesseract.js v5 | Tesseract handles character segmentation, language models, WASM build, Safari compatibility — decades of research |
| PDF from canvas | Custom PDF byte generator | jsPDF 4.2.0 | PDF format internals (xref tables, object streams, font embedding) are complex and security-sensitive |
| Perspective homography math | Custom 4-point transform matrix | Existing `perspectiveWarp()` in upload.js | Already implemented and working; `perspective-transform` (3KB) only if quality proves insufficient |

**Key insight:** The image processing pipeline in upload.js is already quite good — adaptive threshold, Gaussian blur, Sobel edges, perspective warp. Phase 2 is about fixing bugs and adding OCR, not rewriting the pipeline.

---

## Common Pitfalls

### Pitfall 1: iOS Canvas OOM Crash (SCAN-03)
**What goes wrong:** App crashes silently after scanning 3+ invoices in one session on older iPhones. iOS enforces a 224MB hard cap on total canvas memory across all canvases in a tab.
**Why it happens:** `state.scanPages` currently stores live canvas objects. Each 1200x1600 canvas = ~7.7MB of GPU-backed memory. Three canvases = ~23MB, which can stack with the work/output canvases created during processing.
**How to avoid:** Store blobs in `state.scanPages`, not canvases. After `processImage()` returns a canvas, call `canvas.toBlob()`, store the blob, then set `canvas.width = 0; canvas.height = 0`.
**Warning signs:** Console shows "Total canvas memory use exceeds the maximum limit" on iOS.

### Pitfall 2: Black Corners in Perspective Warp Output (SCAN-02 / quality)
**What goes wrong:** After perspective correction, the output image has black triangular artifacts in corners where bilinear interpolation couldn't find source pixels.
**Why it happens:** Line 482 of upload.js: `if (x0 < 0 || ... || y0 >= srcCanvas.height - 1) continue;` — skipping out-of-bounds pixels leaves them at the default `(0,0,0,255)` = black.
**How to avoid:** Clamp source coordinates to valid bounds (`Math.max(0, Math.min(...))`), using the nearest valid pixel (edge extension) instead of skipping.
**Warning signs:** Scanned document previews show dark triangles in corners.

### Pitfall 3: Tesseract.js Worker Not Reused
**What goes wrong:** Creating a new worker on every scan triggers a ~1.5MB WASM download each time, adds 1-2 seconds of initialization per scan, and can accumulate memory.
**Why it happens:** `Tesseract.createWorker()` is called inside the scan handler function instead of at module level.
**How to avoid:** Keep `_worker` as a module-scoped variable. Initialize on first scan, reuse for subsequent scans.
**Warning signs:** Network tab shows WASM download on every scan.

### Pitfall 4: OCR Overwrites User Input
**What goes wrong:** User types a unit number, takes another scan, OCR fires and overwrites the typed value with a misread.
**Why it happens:** OCR result handler always sets field values unconditionally.
**How to avoid:** Only set field values when the field is currently empty. Add a visual "OCR suggestion" class to pre-filled fields so user can see what was auto-detected.

### Pitfall 5: Tesseract.js Loaded Before First Scan
**What goes wrong:** PWA first load includes Tesseract.js (~3MB script + lazy-loaded WASM). This destroys time-to-interactive on cellular and causes the service worker install to exceed budget.
**Why it happens:** Script tag added to `index.html` instead of lazily injected.
**How to avoid:** Never add Tesseract.js to `index.html`. Inject the script tag programmatically on first use, inside `runOCR()`.

### Pitfall 6: jsPDF Global Name Collision
**What goes wrong:** If both old (2.5.2) and new (4.2.0) jsPDF script tags exist in `index.html` simultaneously during a partial upgrade, `window.jspdf` gets overwritten unpredictably.
**Why it happens:** Upgrading CDN URL without removing old tag.
**How to avoid:** Remove the old script tag entirely. Replace it with the new URL in one commit. Verify `window.jspdf` in browser console after deploy.

### Pitfall 7: OCR Runs Before Adaptive Threshold
**What goes wrong:** OCR gets the raw color photo instead of the B&W processed image. Text recognition quality drops significantly on color invoices with background noise.
**Why it happens:** `runOCR()` called on the original file instead of the processed blob.
**How to avoid:** Always run OCR on the blob stored in `state.scanPages[0]` — the blob that was created after `applyAdaptiveThreshold()` ran. Never OCR the raw camera file.

---

## Code Examples

Verified patterns from official sources and codebase analysis:

### jsPDF 4.2.0 CDN (drop-in upgrade)
```html
<!-- Source: github.com/parallax/jsPDF releases confirmed 4.2.0 Feb 2025 -->
<script src="https://cdn.jsdelivr.net/npm/jspdf@4.2.0/dist/jspdf.umd.min.js"></script>
```
The `addImage(imgData, 'JPEG', 0, 0, width, height)` call in `buildPdfFromPages()` is unchanged.

### Tesseract.js v5 Lazy Load + Single Worker
```javascript
// Source: naptha/tesseract.js releases/tag/v5.0.0 - simplified API
let _worker = null;

async function ensureTesseract() {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function runOCR(blob) {
  await ensureTesseract();
  if (!_worker) {
    _worker = await Tesseract.createWorker('eng');
  }
  const { data: { text } } = await _worker.recognize(blob);
  return text;
}
```

### Canvas Blob Conversion + Release
```javascript
// Source: MDN canvas.toBlob() + Apple Developer Forums thread/687866
function processAndRelease(img) {
  const canvas = processImage(img);
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      canvas.width = 0;   // release GPU memory
      canvas.height = 0;
      resolve(blob);
    }, 'image/jpeg', 0.85);
  });
}
```

### buildPdfFromPages() with blob-based pages
```javascript
// Adapted from existing buildPdfFromPages() in upload.js
async function buildPdfFromPages() {
  const { jsPDF } = window.jspdf;

  // Load first blob to get dimensions
  const firstBitmap = await createImageBitmap(state.scanPages[0]);
  const landscape = firstBitmap.width > firstBitmap.height;
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [firstBitmap.width, firstBitmap.height],
  });

  for (let i = 0; i < state.scanPages.length; i++) {
    const bmp = await createImageBitmap(state.scanPages[i]);
    if (i > 0) pdf.addPage([bmp.width, bmp.height], bmp.width > bmp.height ? 'landscape' : 'portrait');

    // Draw to temp canvas, extract data URL, release immediately
    const tmp = document.createElement('canvas');
    tmp.width = bmp.width; tmp.height = bmp.height;
    tmp.getContext('2d').drawImage(bmp, 0, 0);
    const imgData = tmp.toDataURL('image/jpeg', 0.5);
    tmp.width = 0;  // release
    bmp.close();    // release ImageBitmap

    pdf.addImage(imgData, 'JPEG', 0, 0, bmp.width, bmp.height);
  }
  return pdf.output('blob');
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tesseract.js v4: `createWorker()` + `loadLanguage()` + `initialize()` | Tesseract.js v5: `createWorker('eng')` only | v5.0.0 (2023) | Simpler setup; `loadLanguage`/`initialize` now no-ops |
| jsPDF 2.5.2 with PNG encoding regression | jsPDF 4.2.0 with CVE-2025-68428 fixed | v3.0.3 → v4.2.0 (2024-2025) | Security fix; reliable PNG encoding |
| Tesseract.js v4 iOS 17 crash | v5 iOS compatibility fix | v5.0.0 | Required for iPhone users |
| Tesseract.js ~2.8MB English traineddata | v5 ~1.4MB English traineddata | v5.0.0 | 54% reduction; more acceptable lazy-load cost |

**Deprecated/outdated:**
- `worker.initialize('eng')` and `worker.loadLanguage('eng')`: These are no-ops in v5 — delete from any code that calls them. `createWorker('eng')` handles everything.
- jsPDF 2.5.2: Has CVE-2025-68428 (PDF injection/GIF dimension parsing). Never ship this version.

---

## Open Questions

1. **Tesseract.js exact version to pin**
   - What we know: v5 is confirmed stable and iOS 17 compatible. v6 and v7 exist but have not been evaluated.
   - What's unclear: Whether `@5` (latest v5.x) or a pinned `@5.1.1` (latest known v5 patch) is safer.
   - Recommendation: Use `@5` (semver range) in the CDN URL and sw.js cache bust to allow patch updates. Revisit in v6 adoption if OCR quality proves insufficient.

2. **OCR accuracy on handwritten invoice fields**
   - What we know: Tesseract LSTM model handles printed text well. Handwriting accuracy is significantly lower.
   - What's unclear: Whether the invoices from this fleet's vendors are fully printed or partially handwritten.
   - Recommendation: Frame OCR pre-fill as "best-effort suggestions" in the UI. Never disable submit if OCR finds nothing — user can always fill manually.

3. **Rotation deskew integration depth**
   - What we know: The angle computed from `findDocumentCorners()` top edge gives a usable skew estimate when corners are detected.
   - What's unclear: Whether corner detection is reliable enough on photos taken in shop lighting conditions to produce a stable rotation angle.
   - Recommendation: Implement rotation correction but gate it on `Math.abs(angle) > 0.017` (1 degree). If no corners detected, skip rotation entirely. Plan for the possibility that this feature needs to be toggled off if it makes output worse.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in, zero dependency) |
| Config file | none — run via `node --test` |
| Quick run command | `node --test app/graph/csv.test.js` |
| Full suite command | `node --test app/**/*.test.js` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCAN-01 | `applyAdaptiveThreshold()` converts color pixel to 0 or 255 | unit | `node --test app/imaging/scanner.test.js` | No — Wave 0 |
| SCAN-02 | `computeSkewAngle()` returns correct angle from known corners | unit | `node --test app/imaging/scanner.test.js` | No — Wave 0 |
| SCAN-03 | `processAndRelease()` returns a Blob; canvas has width=0 after | unit | `node --test app/imaging/scanner.test.js` | No — Wave 0 |
| SCAN-04 | `index.html` contains jspdf@4.2.0 and NOT jspdf@2.5.2 | smoke (grep) | `node --test app/imaging/scanner.test.js` or grep | No — Wave 0 |
| OCR-01 | `parseInvoiceFields()` returns expected unit/date/service from fixture text | unit | `node --test app/imaging/ocr.test.js` | No — Wave 0 |
| OCR-02 | `parseInvoiceFields()` handles partial matches (date only, service only) | unit | `node --test app/imaging/ocr.test.js` | No — Wave 0 |
| OCR-03 | Pre-population skips non-empty fields (manual — requires DOM) | manual | n/a — iOS browser test | n/a |

**Note on SCAN-01–04 unit tests:** Image processing functions use DOM APIs (`document.createElement('canvas')`, `ImageData`). Node.js does not have a DOM. Test the pure computation functions only (threshold logic with raw arrays, angle calculation with known coords, text parsing). Wire up integration testing via browser DevTools.

### Sampling Rate
- **Per task commit:** `node --test app/imaging/scanner.test.js app/imaging/ocr.test.js`
- **Per wave merge:** `node --test app/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `app/imaging/scanner.test.js` — covers SCAN-01, SCAN-02, SCAN-03 pure-function tests
- [ ] `app/imaging/ocr.test.js` — covers OCR-01, OCR-02 with fixture text strings
- [ ] `app/imaging/scanner.js` — imaging module (extracted from upload.js)
- [ ] `app/imaging/ocr.js` — OCR module (new)

---

## Sources

### Primary (HIGH confidence)
- [jsPDF GitHub Releases](https://github.com/parallax/jsPDF/releases) — v4.2.0 confirmed Feb 2025; CVE-2025-68428 confirmed fixed; addImage API unchanged
- [Tesseract.js v5.0.0 Release Notes](https://github.com/naptha/tesseract.js/releases/tag/v5.0.0) — v5 API simplification confirmed; iOS 17 fix confirmed; 54% eng size reduction confirmed
- [Apple Developer Forums: canvas memory limit](https://developer.apple.com/forums/thread/687866) — 224MB iOS hard cap
- `.planning/codebase/CONCERNS.md` — direct audit of black-corner bug and OOM memory leak
- `app/views/upload.js` (read 2026-03-16) — confirmed existing pipeline: adaptive threshold present, canvas never released, perspective warp has skip-on-oob bug

### Secondary (MEDIUM confidence)
- [Transloadit: Integrating OCR with tesseract.js](https://transloadit.com/devtips/integrating-ocr-in-the-browser-with-tesseract-js/) — browser CDN usage pattern; `result.data.text` structure confirmed
- [naptha/tesseract.js README](https://github.com/naptha/tesseract.js) — CDN URL pattern `@5/dist/tesseract.min.js` confirmed; v5 createWorker API confirmed
- [tesseract.js local-installation docs](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) — workerPath/langPath/corePath configuration confirmed

### Tertiary (LOW confidence — flag for validation)
- Tesseract.js English traineddata v5 size (~1.4MB): derived from "54% smaller than v4's ~2.8MB" — verify before quoting to users
- jsPDF 4.2.0 CDN URL `https://cdn.jsdelivr.net/npm/jspdf@4.2.0/dist/jspdf.umd.min.js`: pattern matches standard jsDelivr naming but could not be directly confirmed by fetching the directory (connection errors). Verify by loading in browser before wiring into `index.html`.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — jsPDF 4.2.0 release confirmed; Tesseract.js v5 API confirmed; Canvas API is spec'd
- Architecture: HIGH — module extraction pattern is standard; blob-not-canvas pattern is well-documented for iOS
- OCR field parsing patterns: MEDIUM — regex patterns are reasonable starting points but will need tuning against real invoice samples
- Deskew rotation approach: MEDIUM — angle-from-corners is geometrically correct; effectiveness depends on corner detection quality in practice

**Research date:** 2026-03-16
**Valid until:** 2026-06-16 (stable libraries; Tesseract.js v5 is stable; jsPDF 4.x is stable)

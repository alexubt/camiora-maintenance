---
phase: quick-2
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/imaging/reviewScreen.js
  - app/views/upload.js
  - style.css
autonomous: true
requirements: [SCAN-REVIEW]

must_haves:
  truths:
    - "After camera capture, user sees original photo with green quad overlay on detected edges"
    - "User can drag 4 corner handles to adjust the crop quad, quad redraws in real-time"
    - "User can tap Original/Grayscale/B&W filter thumbnails to preview each filter"
    - "Accept button applies perspective warp with adjusted corners + selected filter, produces blob"
    - "Retake button dismisses review screen and re-opens camera input"
  artifacts:
    - path: "app/imaging/reviewScreen.js"
      provides: "Review screen component with canvas overlay, draggable handles, filter picker"
      exports: ["showReviewScreen"]
    - path: "app/views/upload.js"
      provides: "Updated camera capture flow routing through review screen"
    - path: "style.css"
      provides: "Review screen styles (filter strip, action buttons)"
  key_links:
    - from: "app/views/upload.js"
      to: "app/imaging/reviewScreen.js"
      via: "import showReviewScreen, call on camera capture"
      pattern: "showReviewScreen"
    - from: "app/imaging/reviewScreen.js"
      to: "app/imaging/scanner.js"
      via: "import edge detection and perspective warp functions"
      pattern: "findDocumentQuadRobust|perspectiveWarp|applyAdaptiveThreshold"
---

<objective>
Add a Scanbot-style post-capture review screen to the scanner flow. After the native camera captures a photo, show the original image with detected document edges overlaid as a draggable quad. The user adjusts corners, picks a filter (Original/Grayscale/B&W), then accepts or retakes.

Purpose: Gives users control over crop boundaries and output filter instead of blind auto-processing.
Output: New reviewScreen.js module, updated upload.js flow, review screen CSS.
</objective>

<execution_context>
@C:/Users/FleetManager/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/FleetManager/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@app/views/upload.js
@app/imaging/scanner.js
@style.css

<interfaces>
<!-- Key exports from scanner.js that the review screen will consume -->

From app/imaging/scanner.js:
```javascript
export function loadImage(file) → Promise<HTMLImageElement>
export function gaussianBlur(gray, w, h) → Uint8Array
export function sobelEdges(gray, w, h) → Uint8Array
export function findDocumentQuadRobust(edges, w, h) → {tl,tr,br,bl} | null
export function findDocumentCorners(edges, w, h) → {tl,tr,br,bl} | null
export function perspectiveWarp(srcCanvas, corners) → HTMLCanvasElement
export function applyAdaptiveThreshold(canvas) → void  // mutates canvas in-place
export function processImage(img) → { scanned: canvas, corrected: canvas }
```

From app/views/upload.js — the handleCameraCapture function (lines 320-350) is the integration point. Currently calls processAndRelease(img) immediately. Will be changed to call showReviewScreen instead.

The scan zone element (#scanZone) is where the review screen will be rendered inline, temporarily replacing its content.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build review screen module and CSS</name>
  <files>app/imaging/reviewScreen.js, style.css</files>
  <action>
Create `app/imaging/reviewScreen.js` as a native ES module exporting a single function:

```
showReviewScreen(img, containerEl) → Promise<{ blob: Blob, ocrCanvas: HTMLCanvasElement } | null>
```

- Returns a Promise that resolves when user taps Accept (with processed blob + ocrCanvas for OCR), or resolves to `null` on Retake.

**Review screen rendering (inside containerEl):**

1. **Canvas setup:** Create a canvas element that fills the container width (100%). Draw the ORIGINAL photo (the `img` HTMLImageElement) scaled to fit. Store the scale factor for coordinate mapping.

2. **Edge detection:** Run the scanner.js pipeline on the image to get detected corners:
   - Create a work canvas, draw img at scale (max 2400px like processImage does)
   - Extract grayscale, gaussianBlur, sobelEdges
   - findDocumentQuadRobust(edges, w, h) || findDocumentCorners(edges, w, h)
   - If no corners detected, default to 10% inset rectangle from image edges
   - Map detected corners from work-canvas coordinates to display-canvas coordinates

3. **Quad overlay:** Draw a semi-transparent green polygon (rgba(29,158,117,0.15) fill, 2px solid #1D9E75 stroke) connecting the 4 corners on the canvas. Redraw on every corner drag.

4. **Corner handles:** Draw 4 white circles (20px radius, 2px #1D9E75 border) at each corner position. Use touch/pointer events for dragging:
   - On pointerdown: check if within 30px of any handle center (44px effective hit area)
   - On pointermove: update that corner position, clamp to canvas bounds, redraw quad + handles
   - On pointerup: release drag
   - Set `touch-action: none` on canvas to prevent scroll interference
   - Use pointer events (not touch events) for unified mouse+touch handling

5. **Filter picker strip:** Below the canvas, render 3 small thumbnail buttons in a horizontal row:
   - "Original" — color crop of center region
   - "Grayscale" — same crop with CSS `filter: grayscale(1)`
   - "B&W" — same crop with CSS `filter: grayscale(1) contrast(2)`
   - Active filter has a green border highlight
   - Store selected filter as state: 'original' | 'grayscale' | 'bw' (default 'bw' since B&W is primary output per user decision)

6. **Action buttons:** Below filter strip, two buttons side by side:
   - "Retake" (secondary style) — resolves promise with null
   - "Accept" (green primary style) — applies processing and resolves with blob

7. **Accept processing:**
   - Map display-canvas corner positions back to original image coordinates (reverse the scale factor)
   - Call `perspectiveWarp(sourceCanvas, corners)` where sourceCanvas has the full-res original image
   - Apply selected filter:
     - 'original': no filter
     - 'grayscale': draw warped canvas with `ctx.filter = 'grayscale(1)'`
     - 'bw': call `applyAdaptiveThreshold(warpedCanvas)`
   - Create ocrCanvas: clone the warped canvas at max 1600px, draw with `filter: 'grayscale(1) contrast(1.3)'` (same as current processAndRelease)
   - Convert final canvas to blob (JPEG 0.85)
   - Clean up all canvases (set width=0)
   - Resolve promise with { blob, ocrCanvas }

Import from scanner.js: gaussianBlur, sobelEdges, findDocumentQuadRobust, findDocumentCorners, perspectiveWarp, applyAdaptiveThreshold.

**CSS additions to style.css:**

Add styles for the review screen components:
- `.review-screen` — container, flex column, gap 12px
- `.review-canvas-wrap` — relative container for the canvas, width 100%, border-radius 12px, overflow hidden
- `.review-canvas-wrap canvas` — display block, width 100%
- `.review-filters` — flex row, gap 10px, justify-content center, padding 8px 0
- `.review-filter-btn` — 64px x 64px, border-radius 10px, overflow hidden, border 2px solid transparent, cursor pointer, touch-action manipulation, position relative
- `.review-filter-btn.active` — border-color var(--green-mid)
- `.review-filter-label` — absolute bottom, centered text, 10px font, white on dark semi-transparent bg
- `.review-actions` — flex row, gap 10px
- `.review-retake-btn` — flex 1, height 48px, border-radius var(--radius), bg var(--bg-2), border 1px solid var(--border-2), font 15px weight 500
- `.review-accept-btn` — flex 1, height 48px, border-radius var(--radius), bg var(--green), color white, border none, font 15px weight 600
  </action>
  <verify>
    <automated>node -e "import('./app/imaging/reviewScreen.js').catch(e => { console.error(e.message); process.exit(1); })"</automated>
  </verify>
  <done>reviewScreen.js exports showReviewScreen function. CSS classes for review screen added to style.css. Module parses without syntax errors.</done>
</task>

<task type="auto">
  <name>Task 2: Wire review screen into upload.js camera flow</name>
  <files>app/views/upload.js</files>
  <action>
Modify `app/views/upload.js` to route camera captures through the review screen instead of immediately processing.

1. **Add import:** Add `import { showReviewScreen } from '../imaging/reviewScreen.js';` at the top alongside existing scanner imports.

2. **Replace handleCameraCapture logic (lines 320-350):** The new flow:

```javascript
async function handleCameraCapture(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];

  const zone = document.getElementById('scanZone');
  const origHTML = zone.innerHTML;
  const origPointerEvents = zone.style.pointerEvents;

  // Show loading while image loads
  zone.innerHTML = `<div class="scan-processing"><div class="scan-spinner"></div><div>Loading...</div></div>`;
  zone.style.pointerEvents = 'none';

  try {
    const img = await loadImage(file);

    // Show review screen inline in the scan zone
    zone.innerHTML = '';
    zone.style.pointerEvents = '';
    zone.style.padding = '0';
    zone.style.border = 'none';
    zone.style.background = 'none';
    zone.style.cursor = 'default';

    // Temporarily remove the click-to-open-camera listener by cloning
    const newZone = zone.cloneNode(false);
    zone.parentNode.replaceChild(newZone, zone);

    const result = await showReviewScreen(img, newZone);

    // Restore original scan zone
    newZone.innerHTML = origHTML;
    newZone.style.pointerEvents = origPointerEvents;
    newZone.style.padding = '';
    newZone.style.border = '';
    newZone.style.background = '';
    newZone.style.cursor = '';

    // Re-attach click listener to restored zone
    const restoredZone = document.getElementById('scanZone') || newZone;
    // The newZone doesn't have id — we need to set it
    newZone.id = 'scanZone';
    newZone.className = 'scan-zone';
    newZone.addEventListener('click', openCamera);

    if (!result) {
      // User tapped Retake — re-open camera
      openCamera();
      return;
    }

    // User accepted — store blob and continue normal flow
    state.scanPages.push(result.blob);
    renderScanPages();
    await buildPdfFromPages();

    // Run OCR on the ocrCanvas (convert to blob first)
    if (result.ocrCanvas) {
      const ocrBlob = await new Promise(resolve =>
        result.ocrCanvas.toBlob(resolve, 'image/jpeg', 0.85)
      );
      result.ocrCanvas.width = 0;
      result.ocrCanvas.height = 0;

      runOCR(ocrBlob).then(fields => {
        if (fields) prefillFormFields(fields);
      }).catch(err => console.error('OCR failed:', err));
    }
  } catch (err) {
    console.error('Scan error:', err);
    showToast('Failed to process image', 'error');

    // Restore zone on error
    const currentZone = document.getElementById('scanZone');
    if (currentZone) {
      currentZone.innerHTML = origHTML;
      currentZone.style.pointerEvents = origPointerEvents;
      currentZone.style.padding = '';
      currentZone.style.border = '';
      currentZone.style.background = '';
      currentZone.style.cursor = '';
    }
  }
}
```

Note: The zone restoration approach above using cloneNode is to detach the scan-zone click handler so tapping on the review screen canvas doesn't re-open the camera. A simpler alternative: instead of cloning, just use a flag `let reviewActive = false;` and guard openCamera with `if (reviewActive) return;`. Use whichever approach is cleaner — the key requirement is that the scan zone click handler does NOT fire while the review screen is displayed.

3. **Keep processAndRelease import** — it's still used if "Add another page" re-processes existing pages. Actually check: addMorePages calls openCamera which will now go through review screen. So processAndRelease is no longer directly called. Remove the import of `processAndRelease` from the import line (keep `loadImage`). Verify no other code in upload.js calls processAndRelease — if not, remove it from the import.
  </action>
  <verify>
    <automated>node -e "import('./app/views/upload.js').catch(e => { console.error(e.message); process.exit(1); })"</automated>
  </verify>
  <done>Camera capture routes through review screen. User sees original photo with edge overlay and can drag corners, pick filter, accept or retake. Accept produces blob that enters the existing PDF pipeline. Retake re-opens camera.</done>
</task>

</tasks>

<verification>
1. Open the app on a mobile device or Chrome DevTools mobile emulator
2. Tap "Scan document" to open camera, take a photo
3. Review screen appears inline showing the original photo with green quad overlay
4. 4 white circle handles visible at detected document corners
5. Drag any corner — quad redraws in real-time
6. Filter strip shows Original/Grayscale/B&W thumbnails — tapping switches active highlight
7. Tap "Accept" — processing spinner briefly, then scan page thumbnail appears in the page list
8. Tap "Retake" instead — camera re-opens
9. After accept, OCR results banner appears (if text detected)
10. PDF is built normally from the accepted scan
</verification>

<success_criteria>
- Review screen renders inline in scan zone area (not a modal or new route)
- Original photo displayed with semi-transparent green quad overlay
- 4 draggable corner handles with 44px+ touch hit area
- Real-time quad redraw on drag
- Filter picker with 3 options (Original, Grayscale, B&W), B&W default
- Accept applies perspective warp with user-adjusted corners + selected filter
- Retake dismisses review and re-opens camera
- Existing OCR and PDF pipeline still works after accept
- No memory leaks (all temp canvases released)
</success_criteria>

<output>
After completion, create `.planning/quick/2-scanbot-style-scanner-review-screen/2-SUMMARY.md`
</output>

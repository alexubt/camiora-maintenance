/**
 * Post-capture review screen for document scanning.
 * Shows original photo with draggable corner handles over detected edges,
 * filter picker (Original/Grayscale/B&W), and Accept/Retake actions.
 *
 * Native ES module.
 */

import {
  gaussianBlur,
  sobelEdges,
  findDocumentQuadRobust,
  findDocumentCorners,
  perspectiveWarp,
  applyAdaptiveThreshold,
} from './scanner.js';

/**
 * Show a review screen inside the given container element.
 * @param {HTMLImageElement} img - The captured photo
 * @param {HTMLElement} containerEl - Where to render the review screen
 * @returns {Promise<{ blob: Blob, ocrCanvas: HTMLCanvasElement } | null>}
 *   Resolves with processed result on Accept, or null on Retake.
 */
export function showReviewScreen(img, containerEl) {
  return new Promise((resolve) => {
    // -- State --
    let selectedFilter = 'bw'; // default per user decision
    let activeHandle = -1;     // index of handle being dragged, -1 = none

    // -- Scale factor: map original image onto display canvas --
    const MAX_WORK = 2400;
    const workScale = Math.min(1, MAX_WORK / Math.max(img.width, img.height));
    const workW = Math.round(img.width * workScale);
    const workH = Math.round(img.height * workScale);

    // -- Edge detection on work-sized image --
    const workCanvas = document.createElement('canvas');
    workCanvas.width = workW;
    workCanvas.height = workH;
    const wCtx = workCanvas.getContext('2d');
    wCtx.drawImage(img, 0, 0, workW, workH);

    const imageData = wCtx.getImageData(0, 0, workW, workH);
    const gray = new Uint8Array(workW * workH);
    for (let i = 0; i < workW * workH; i++) {
      gray[i] = Math.round(
        0.299 * imageData.data[i * 4] +
        0.587 * imageData.data[i * 4 + 1] +
        0.114 * imageData.data[i * 4 + 2]
      );
    }
    const blurred = gaussianBlur(gray, workW, workH);
    const edges = sobelEdges(blurred, workW, workH);

    let detectedCorners = findDocumentQuadRobust(edges, workW, workH) ||
                          findDocumentCorners(edges, workW, workH);

    // Default to 10% inset if no corners detected
    if (!detectedCorners) {
      detectedCorners = {
        tl: { x: workW * 0.1, y: workH * 0.1 },
        tr: { x: workW * 0.9, y: workH * 0.1 },
        br: { x: workW * 0.9, y: workH * 0.9 },
        bl: { x: workW * 0.1, y: workH * 0.9 },
      };
    }

    // Release work canvas (we only needed edge data)
    workCanvas.width = 0;
    workCanvas.height = 0;

    // -- Build DOM --
    containerEl.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'review-screen';

    // Canvas container
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'review-canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.touchAction = 'none';
    canvasWrap.appendChild(canvas);
    wrapper.appendChild(canvasWrap);

    // Determine display size after layout
    containerEl.appendChild(wrapper);

    // Use container width to size the canvas
    const containerWidth = containerEl.clientWidth || 360;
    const displayScale = containerWidth / img.width;
    const displayW = Math.round(img.width * displayScale);
    const displayH = Math.round(img.height * displayScale);

    canvas.width = displayW;
    canvas.height = displayH;
    const ctx = canvas.getContext('2d');

    // Map detected corners from work-canvas coords to display-canvas coords
    const workToDisplay = workScale > 0 ? displayScale / workScale : displayScale;
    const corners = [
      { x: detectedCorners.tl.x * workToDisplay, y: detectedCorners.tl.y * workToDisplay },
      { x: detectedCorners.tr.x * workToDisplay, y: detectedCorners.tr.y * workToDisplay },
      { x: detectedCorners.br.x * workToDisplay, y: detectedCorners.br.y * workToDisplay },
      { x: detectedCorners.bl.x * workToDisplay, y: detectedCorners.bl.y * workToDisplay },
    ];

    // -- Draw function --
    function draw() {
      ctx.clearRect(0, 0, displayW, displayH);
      ctx.drawImage(img, 0, 0, displayW, displayH);

      // Quad fill
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(29,158,117,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#1D9E75';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Corner handles
      for (const c of corners) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#1D9E75';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    draw();

    // -- Pointer events for dragging --
    const HIT_RADIUS = 30; // 44px effective with 20px visual radius

    function getCanvasPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = displayW / rect.width;
      const scaleY = displayH / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }

    canvas.addEventListener('pointerdown', (e) => {
      const pos = getCanvasPos(e);
      for (let i = 0; i < 4; i++) {
        const dx = pos.x - corners[i].x;
        const dy = pos.y - corners[i].y;
        if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) {
          activeHandle = i;
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (activeHandle < 0) return;
      const pos = getCanvasPos(e);
      corners[activeHandle].x = Math.max(0, Math.min(displayW, pos.x));
      corners[activeHandle].y = Math.max(0, Math.min(displayH, pos.y));
      draw();
      e.preventDefault();
    });

    canvas.addEventListener('pointerup', () => {
      activeHandle = -1;
    });

    canvas.addEventListener('pointercancel', () => {
      activeHandle = -1;
    });

    // -- Filter picker --
    const filterStrip = document.createElement('div');
    filterStrip.className = 'review-filters';

    // Create a small center crop thumbnail for filter previews
    const thumbSize = 64;
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbSize;
    thumbCanvas.height = thumbSize;
    const tCtx = thumbCanvas.getContext('2d');
    // Crop from center of image
    const cropSize = Math.min(img.width, img.height) * 0.3;
    const cropX = (img.width - cropSize) / 2;
    const cropY = (img.height - cropSize) / 2;
    tCtx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, thumbSize, thumbSize);
    const thumbDataURL = thumbCanvas.toDataURL('image/jpeg', 0.7);
    thumbCanvas.width = 0;
    thumbCanvas.height = 0;

    const filters = [
      { id: 'original', label: 'Original', css: '' },
      { id: 'grayscale', label: 'Grayscale', css: 'grayscale(1)' },
      { id: 'bw', label: 'B&W', css: 'grayscale(1) contrast(2)' },
    ];

    const filterBtns = [];
    for (const f of filters) {
      const btn = document.createElement('button');
      btn.className = 'review-filter-btn' + (f.id === selectedFilter ? ' active' : '');
      btn.type = 'button';

      const thumbImg = document.createElement('img');
      thumbImg.src = thumbDataURL;
      thumbImg.style.width = '100%';
      thumbImg.style.height = '100%';
      thumbImg.style.objectFit = 'cover';
      thumbImg.style.display = 'block';
      if (f.css) thumbImg.style.filter = f.css;
      btn.appendChild(thumbImg);

      const label = document.createElement('span');
      label.className = 'review-filter-label';
      label.textContent = f.label;
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        selectedFilter = f.id;
        for (const b of filterBtns) b.classList.remove('active');
        btn.classList.add('active');
      });

      filterBtns.push(btn);
      filterStrip.appendChild(btn);
    }

    wrapper.appendChild(filterStrip);

    // -- Action buttons --
    const actions = document.createElement('div');
    actions.className = 'review-actions';

    const retakeBtn = document.createElement('button');
    retakeBtn.className = 'review-retake-btn';
    retakeBtn.type = 'button';
    retakeBtn.textContent = 'Retake';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'review-accept-btn';
    acceptBtn.type = 'button';
    acceptBtn.textContent = 'Accept';

    actions.appendChild(retakeBtn);
    actions.appendChild(acceptBtn);
    wrapper.appendChild(actions);

    // -- Retake --
    retakeBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    // -- Accept --
    acceptBtn.addEventListener('click', async () => {
      // Show processing spinner
      wrapper.innerHTML = '<div class="scan-processing"><div class="scan-spinner"></div><div>Processing...</div></div>';

      try {
        // Map display corners back to original image coordinates
        const displayToOrig = 1 / displayScale;
        const origCorners = {
          tl: { x: corners[0].x * displayToOrig, y: corners[0].y * displayToOrig },
          tr: { x: corners[1].x * displayToOrig, y: corners[1].y * displayToOrig },
          br: { x: corners[2].x * displayToOrig, y: corners[2].y * displayToOrig },
          bl: { x: corners[3].x * displayToOrig, y: corners[3].y * displayToOrig },
        };

        // Create full-res source canvas
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        srcCanvas.getContext('2d').drawImage(img, 0, 0);

        // Perspective warp
        let warped = perspectiveWarp(srcCanvas, origCorners);
        srcCanvas.width = 0;
        srcCanvas.height = 0;

        // Apply selected filter
        if (selectedFilter === 'bw') {
          applyAdaptiveThreshold(warped);
        } else if (selectedFilter === 'grayscale') {
          const gCtx = warped.getContext('2d');
          gCtx.filter = 'grayscale(1)';
          gCtx.drawImage(warped, 0, 0);
          gCtx.filter = 'none';
        }
        // 'original' — no filter

        // Create ocrCanvas: clone warped at max 1600px with grayscale+contrast
        const ocrCanvas = document.createElement('canvas');
        const ocrScale = Math.min(1, 1600 / Math.max(warped.width, warped.height));
        ocrCanvas.width = Math.round(warped.width * ocrScale);
        ocrCanvas.height = Math.round(warped.height * ocrScale);
        const oCtx = ocrCanvas.getContext('2d');
        oCtx.filter = 'grayscale(1) contrast(1.3)';
        oCtx.drawImage(warped, 0, 0, ocrCanvas.width, ocrCanvas.height);

        // Convert warped to blob
        const blob = await new Promise((res) =>
          warped.toBlob(res, 'image/jpeg', 0.85)
        );

        // Cleanup warped canvas
        warped.width = 0;
        warped.height = 0;

        cleanup();
        resolve({ blob, ocrCanvas });
      } catch (err) {
        console.error('Review screen processing error:', err);
        cleanup();
        resolve(null);
      }
    });

    function cleanup() {
      // Release the display canvas
      canvas.width = 0;
      canvas.height = 0;
    }
  });
}

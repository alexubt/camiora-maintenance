/**
 * Live camera viewfinder module with real-time edge detection overlay.
 *
 * Exports one function: openLiveScanner(containerEl, { onDone, onCancel, onFallback })
 *
 * - getUserMedia opens the rear camera into a fullscreen viewfinder
 * - Edge detection runs in a Web Worker at ~5fps (non-blocking)
 * - Smooth lerp-interpolated green quad overlay renders at 60fps
 * - User taps capture to snap a page; multiple pages are supported
 * - "Done - Extract" returns an array of JPEG Blobs via onDone()
 * - If getUserMedia is unavailable or denied, onFallback() is invoked
 * - All stream tracks are stopped on every exit path
 *
 * Native ES module — no build step required.
 */

import { processImage } from './scanner.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mount the live camera scanner UI inside containerEl.
 *
 * @param {HTMLElement} containerEl  - Element to mount scanner into
 * @param {object}      callbacks
 * @param {function}    callbacks.onDone(blobs)    - called with array of JPEG Blobs
 * @param {function}    callbacks.onCancel()       - called when user closes without capturing
 * @param {function}    callbacks.onFallback()     - called if camera is unavailable/denied
 */
export function openLiveScanner(containerEl, { onDone, onCancel, onFallback }) {
  // ── State ─────────────────────────────────────────────────────────────────

  let stream = null;
  let worker = null;
  let workerSupported = true;
  let workerBusy = false;
  let scannerActive = false;

  /** @type {{tl,tr,br,bl}|null} Latest corners from worker */
  let currentCorners = null;
  /** @type {{tl,tr,br,bl}|null} Smoothly interpolated corners for rendering */
  let displayCorners = null;

  let lastFrameSent = 0;
  let noCornersSince = 0; // timestamp when currentCorners went null
  let detectionFrameW = 360; // width of the frame sent to worker
  let detectionFrameH = 240; // height of the frame sent to worker

  /** @type {Blob[]} Captured JPEG blobs for each scanned page */
  const scannedPages = [];

  /** @type {string[]} ObjectURLs that must be revoked on exit */
  const blobUrls = [];

  // ── DOM construction ──────────────────────────────────────────────────────

  const scannerEl = document.createElement('div');
  scannerEl.className = 'live-scanner';

  const videoEl = document.createElement('video');
  videoEl.id = 'liveVideo';
  videoEl.autoplay = true;
  videoEl.muted = true;
  videoEl.setAttribute('playsinline', '');

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.className = 'live-scanner__overlay';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'live-scanner__close';
  closeBtn.setAttribute('aria-label', 'Close scanner');
  closeBtn.textContent = '\u00d7'; // ×

  const bottomBar = document.createElement('div');
  bottomBar.className = 'live-scanner__bottom';

  const thumbnailsEl = document.createElement('div');
  thumbnailsEl.className = 'live-scanner__thumbnails';

  const captureBtn = document.createElement('button');
  captureBtn.className = 'live-scanner__capture';
  captureBtn.setAttribute('aria-label', 'Capture page');

  const doneBtn = document.createElement('button');
  doneBtn.className = 'live-scanner__done';
  doneBtn.textContent = 'Done \u2014 Extract';
  doneBtn.disabled = true;

  bottomBar.appendChild(thumbnailsEl);
  bottomBar.appendChild(captureBtn);
  bottomBar.appendChild(doneBtn);

  scannerEl.appendChild(videoEl);
  scannerEl.appendChild(overlayCanvas);
  scannerEl.appendChild(closeBtn);
  scannerEl.appendChild(bottomBar);

  containerEl.appendChild(scannerEl);

  // ── Overlay canvas sizing ─────────────────────────────────────────────────

  function syncOverlaySize() {
    overlayCanvas.width = videoEl.offsetWidth || videoEl.clientWidth || window.innerWidth;
    overlayCanvas.height = videoEl.offsetHeight || videoEl.clientHeight || window.innerHeight;
  }

  videoEl.addEventListener('loadedmetadata', syncOverlaySize);
  window.addEventListener('resize', syncOverlaySize);

  // ── Lerp helpers ──────────────────────────────────────────────────────────

  function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function lerpCorners(from, to, t) {
    return {
      tl: lerpPoint(from.tl, to.tl, t),
      tr: lerpPoint(from.tr, to.tr, t),
      br: lerpPoint(from.br, to.br, t),
      bl: lerpPoint(from.bl, to.bl, t),
    };
  }

  // ── Overlay drawing ───────────────────────────────────────────────────────

  function drawOverlay(corners) {
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!corners) return;

    // Corners are in detection frame coordinates (e.g. 360x240).
    // The video uses object-fit:cover which crops the frame to fill
    // the viewport. We must account for that crop offset.
    const canvasW = overlayCanvas.width;
    const canvasH = overlayCanvas.height;
    const videoNativeW = videoEl.videoWidth || 1;
    const videoNativeH = videoEl.videoHeight || 1;

    // object-fit:cover scale factor — scale to fill, then crop
    const coverScale = Math.max(canvasW / videoNativeW, canvasH / videoNativeH);
    const displayedW = videoNativeW * coverScale;
    const displayedH = videoNativeH * coverScale;
    const offsetX = (displayedW - canvasW) / 2;
    const offsetY = (displayedH - canvasH) / 2;

    // detection coords → video native → displayed → minus crop offset
    const detToNativeX = videoNativeW / detectionFrameW;
    const detToNativeY = videoNativeH / detectionFrameH;

    function toCanvas(pt) {
      return {
        x: pt.x * detToNativeX * coverScale - offsetX,
        y: pt.y * detToNativeY * coverScale - offsetY,
      };
    }

    const tl = toCanvas(corners.tl);
    const tr = toCanvas(corners.tr);
    const br = toCanvas(corners.br);
    const bl = toCanvas(corners.bl);

    // Semi-transparent fill
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(34,197,94,0.15)';
    ctx.fill();

    // Solid stroke
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Corner dots
    ctx.fillStyle = '#22c55e';
    for (const pt of [tl, tr, br, bl]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Worker frame sending ──────────────────────────────────────────────────

  function sendFrameToWorker() {
    if (!workerSupported || !worker) return;

    const thumbW = 360;
    const thumbH = Math.round((videoEl.videoHeight / videoEl.videoWidth) * thumbW) || 240;

    const tmp = document.createElement('canvas');
    tmp.width = thumbW;
    tmp.height = thumbH;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, thumbW, thumbH);

    const imageData = ctx.getImageData(0, 0, thumbW, thumbH);
    // Transfer the underlying buffer to avoid a structured-clone copy
    const rgba = imageData.data.buffer;

    // Release the temporary canvas immediately
    tmp.width = 0;
    tmp.height = 0;

    detectionFrameW = thumbW;
    detectionFrameH = thumbH;
    workerBusy = true;
    worker.postMessage({ rgba, width: thumbW, height: thumbH }, [rgba]);
  }

  // ── rAF overlay loop ──────────────────────────────────────────────────────

  const FRAME_INTERVAL_MS = 200; // ~5fps for worker
  const LERP_FACTOR = 0.15;
  const NO_CORNER_FADE_MS = 300; // clear display after this long without corners

  function overlayLoop(timestamp) {
    if (!scannerActive) return;

    // Throttle: send a frame to the worker at ~5fps
    if (!workerBusy && timestamp - lastFrameSent > FRAME_INTERVAL_MS) {
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        sendFrameToWorker();
        lastFrameSent = timestamp;
      }
    }

    // Lerp displayCorners toward currentCorners
    if (currentCorners) {
      noCornersSince = 0;
      if (!displayCorners) {
        displayCorners = { ...currentCorners };
      } else {
        displayCorners = lerpCorners(displayCorners, currentCorners, LERP_FACTOR);
      }
    } else {
      if (displayCorners) {
        if (noCornersSince === 0) noCornersSince = timestamp;
        if (timestamp - noCornersSince > NO_CORNER_FADE_MS) {
          displayCorners = null;
        }
      }
    }

    drawOverlay(displayCorners);
    requestAnimationFrame(overlayLoop);
  }

  // ── Worker initialisation ─────────────────────────────────────────────────

  function initWorker() {
    try {
      worker = new Worker('./app/imaging/detect-worker.js', { type: 'module' });
      worker.onmessage = ({ data: { corners } }) => {
        currentCorners = corners || null;
        workerBusy = false;
      };
      worker.onerror = (err) => {
        console.warn('[live-scanner] Worker error:', err);
        workerSupported = false;
        workerBusy = false;
      };
    } catch (err) {
      console.warn('[live-scanner] Worker construction failed:', err);
      workerSupported = false;
      if (typeof onFallback === 'function') {
        exitScanner();
        onFallback();
      }
    }
  }

  // ── Camera startup ────────────────────────────────────────────────────────

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (typeof onFallback === 'function') {
        exitScanner();
        onFallback();
      }
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      // Wait for video to be ready before playing — iOS needs this
      videoEl.srcObject = stream;
      await new Promise((resolve, reject) => {
        videoEl.onloadedmetadata = () => {
          videoEl.play()
            .then(resolve)
            .catch(reject);
        };
        // Timeout fallback in case loadedmetadata never fires
        setTimeout(() => {
          videoEl.play().then(resolve).catch(reject);
        }, 2000);
      });

      syncOverlaySize();

      // If any track ends unexpectedly (camera error, system reclaim), clean up
      stream.getTracks().forEach(t => {
        t.addEventListener('ended', () => {
          console.warn('[live-scanner] Camera track ended unexpectedly');
          exitScanner();
        });
      });
    } catch (err) {
      console.warn('[live-scanner] Camera error:', err);
      showToast('Camera access needed for live scanner \u2014 using photo mode');
      if (typeof onFallback === 'function') {
        exitScanner();
        onFallback();
      }
    }
  }

  // ── Toast helper ──────────────────────────────────────────────────────────

  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ── Flash feedback ────────────────────────────────────────────────────────

  function flashCapture() {
    const flash = document.createElement('div');
    flash.className = 'capture-flash';
    scannerEl.appendChild(flash);
    setTimeout(() => flash.remove(), 300);
  }

  // ── Thumbnail strip ───────────────────────────────────────────────────────

  function renderThumbnailStrip() {
    thumbnailsEl.innerHTML = '';

    for (let i = 0; i < scannedPages.length; i++) {
      const blob = scannedPages[i];
      const url = URL.createObjectURL(blob);
      blobUrls.push(url);

      const wrap = document.createElement('div');
      wrap.className = 'live-scanner__thumb-wrap';

      const img = document.createElement('img');
      img.src = url;
      img.className = 'live-scanner__thumb';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'live-scanner__thumb-remove';
      removeBtn.setAttribute('aria-label', 'Remove page');
      removeBtn.textContent = '\u00d7';

      const idx = i;
      removeBtn.addEventListener('click', () => {
        // Revoke the specific URL for this thumbnail
        const revokeUrl = img.src;
        URL.revokeObjectURL(revokeUrl);
        const urlIdx = blobUrls.indexOf(revokeUrl);
        if (urlIdx !== -1) blobUrls.splice(urlIdx, 1);

        scannedPages.splice(idx, 1);
        renderThumbnailStrip();
      });

      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      thumbnailsEl.appendChild(wrap);
    }

    // Enable Done button only when at least 1 page captured
    doneBtn.disabled = scannedPages.length === 0;
  }

  // ── Capture press ─────────────────────────────────────────────────────────

  // ── Torch helper ──────────────────────────────────────────────────────────

  async function setTorch(on) {
    if (!stream) return false;
    const track = stream.getVideoTracks()[0];
    if (!track) return false;
    try {
      const caps = track.getCapabilities?.();
      if (!caps?.torch) return false;
      await track.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function onCapturePress() {
    if (!videoEl.videoWidth) return;

    captureBtn.disabled = true;

    // Show spinner while processing
    const spinner = document.createElement('div');
    spinner.className = 'live-scanner__spinner';
    thumbnailsEl.appendChild(spinner);

    // Turn on torch for maximum detail, wait for exposure to adjust
    const torchOn = await setTorch(true);
    if (torchOn) await new Promise(r => setTimeout(r, 400));

    flashCapture();

    // Draw at full stream resolution
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = videoEl.videoWidth;
    captureCanvas.height = videoEl.videoHeight;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0);

    // Turn off torch immediately after capture
    if (torchOn) setTorch(false);

    try {
      // processImage accepts an HTMLCanvasElement (drawImage-compatible)
      const { scanned } = processImage(captureCanvas);

      // Convert scanned canvas to JPEG blob at 0.85 quality
      const blob = await new Promise(resolve =>
        scanned.toBlob(resolve, 'image/jpeg', 0.85)
      );

      // Release canvases immediately
      scanned.width = 0;
      scanned.height = 0;
      captureCanvas.width = 0;
      captureCanvas.height = 0;

      if (blob) {
        scannedPages.push(blob);
      }
    } catch (err) {
      console.error('[live-scanner] Capture failed:', err);
      captureCanvas.width = 0;
      captureCanvas.height = 0;
    }

    // Remove spinner and re-render
    spinner.remove();
    captureBtn.disabled = false;
    renderThumbnailStrip();
  }

  // ── Done press ────────────────────────────────────────────────────────────

  function onDonePress() {
    const pages = [...scannedPages];
    exitScanner();
    if (typeof onDone === 'function') onDone(pages);
  }

  // ── Exit scanner ──────────────────────────────────────────────────────────

  function exitScanner() {
    if (!scannerActive && !stream) return; // already exited
    scannerActive = false;

    // Clear video source — iOS keeps camera active without this
    try {
      videoEl.pause();
      videoEl.srcObject = null;
      videoEl.load(); // force iOS to release camera
    } catch (_) {}

    // Stop all camera tracks — belt and suspenders
    if (stream) {
      try {
        stream.getTracks().forEach(t => {
          t.stop();
          stream.removeTrack(t);
        });
      } catch (_) {}
      stream = null;
    }

    // Terminate worker
    if (worker) {
      try { worker.terminate(); } catch (_) {}
      worker = null;
    }

    // Revoke all blob URLs
    blobUrls.forEach(url => URL.revokeObjectURL(url));
    blobUrls.length = 0;

    // Detach all listeners
    window.removeEventListener('resize', syncOverlaySize);
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    window.removeEventListener('hashchange', _onNavAway);
    window.removeEventListener('pagehide', exitScanner);

    // Remove scanner DOM
    if (scannerEl.parentNode) scannerEl.remove();
  }

  // ── Safety nets — stop camera if user navigates away ────────────────────

  function _onVisibilityChange() {
    if (document.visibilityState === 'hidden' && stream) {
      // Pause camera when app goes to background (iOS)
      videoEl.pause();
      stream.getTracks().forEach(t => { if (t.enabled) t.enabled = false; });
    } else if (document.visibilityState === 'visible' && stream) {
      stream.getTracks().forEach(t => { t.enabled = true; });
      videoEl.play().catch(() => {});
    }
  }

  function _onNavAway() {
    // Hash changed — user navigated to another page
    exitScanner();
    if (typeof onCancel === 'function') onCancel();
  }

  document.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('hashchange', _onNavAway);
  window.addEventListener('pagehide', exitScanner);

  // ── Button wiring ─────────────────────────────────────────────────────────

  closeBtn.addEventListener('click', () => {
    exitScanner();
    if (typeof onCancel === 'function') onCancel();
  });

  captureBtn.addEventListener('click', onCapturePress);
  doneBtn.addEventListener('click', onDonePress);

  // ── Launch sequence ───────────────────────────────────────────────────────

  initWorker();
  scannerActive = true;
  startCamera().then(() => {
    requestAnimationFrame(overlayLoop);
  });

  renderThumbnailStrip();
}

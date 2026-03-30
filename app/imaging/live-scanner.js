/**
 * Live camera viewfinder with real-time edge detection overlay.
 *
 * Simplified approach inspired by jscanify — no Web Workers, no complex
 * lifecycle management. Detection runs on main thread via setInterval,
 * overlay drawn immediately after each detection.
 *
 * Native ES module — no build step, no dependencies beyond scanner.js.
 */

import { detectDocument } from './scanner-core.js';
import { processImage } from './scanner.js';

// ── Public API ────────────────────────────────────────────────────────────────

export function openLiveScanner(containerEl, { onDone, onCancel, onFallback }) {

  let stream = null;
  let detectInterval = null;
  let overlayRaf = null;
  let active = false;

  let currentCorners = null;
  let displayCorners = null;
  let detFrameW = 360;
  let detFrameH = 240;
  let lastDetectTime = 0;

  const scannedPages = [];
  const blobUrls = [];

  // Reusable detection canvas — created once, reused every interval
  const detCanvas = document.createElement('canvas');
  const detCtx = detCanvas.getContext('2d', { willReadFrequently: true });

  // ── DOM ───────────────────────────────────────────────────────────────────

  const el = document.createElement('div');
  el.className = 'live-scanner';

  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.setAttribute('playsinline', '');

  const overlay = document.createElement('canvas');
  overlay.className = 'live-scanner__overlay';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'live-scanner__close';
  closeBtn.textContent = '\u00d7';

  const bottom = document.createElement('div');
  bottom.className = 'live-scanner__bottom';

  const thumbs = document.createElement('div');
  thumbs.className = 'live-scanner__thumbnails';

  const capBtn = document.createElement('button');
  capBtn.className = 'live-scanner__capture';

  const doneBtn = document.createElement('button');
  doneBtn.className = 'live-scanner__done';
  doneBtn.textContent = 'Done \u2014 Extract';
  doneBtn.disabled = true;

  bottom.append(thumbs, capBtn, doneBtn);
  el.append(video, overlay, closeBtn, bottom);
  containerEl.appendChild(el);

  // ── Overlay sizing ────────────────────────────────────────────────────────

  function syncSize() {
    overlay.width = video.offsetWidth || window.innerWidth;
    overlay.height = video.offsetHeight || window.innerHeight;
  }
  video.addEventListener('loadedmetadata', syncSize);

  // ── Detection (main thread, ~5fps via setInterval) ────────────────────────

  function runDetection() {
    if (!active || video.readyState < 2 || !video.videoWidth) return;

    const thumbW = 360;
    const thumbH = Math.round((video.videoHeight / video.videoWidth) * thumbW) || 240;

    detCanvas.width = thumbW;
    detCanvas.height = thumbH;
    detCtx.drawImage(video, 0, 0, thumbW, thumbH);

    const imageData = detCtx.getImageData(0, 0, thumbW, thumbH);
    const corners = detectDocument(imageData.data, thumbW, thumbH);

    detFrameW = thumbW;
    detFrameH = thumbH;
    currentCorners = corners || null;
    lastDetectTime = performance.now();
  }

  // ── Overlay rendering (60fps rAF with lerp) ───────────────────────────────

  const LERP = 0.2;
  const FADE_MS = 400;

  function lerpPt(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function drawLoop() {
    if (!active) return;

    // Lerp toward current corners
    if (currentCorners) {
      if (!displayCorners) {
        displayCorners = { tl: { ...currentCorners.tl }, tr: { ...currentCorners.tr }, br: { ...currentCorners.br }, bl: { ...currentCorners.bl } };
      } else {
        displayCorners = {
          tl: lerpPt(displayCorners.tl, currentCorners.tl, LERP),
          tr: lerpPt(displayCorners.tr, currentCorners.tr, LERP),
          br: lerpPt(displayCorners.br, currentCorners.br, LERP),
          bl: lerpPt(displayCorners.bl, currentCorners.bl, LERP),
        };
      }
    } else if (displayCorners && performance.now() - lastDetectTime > FADE_MS) {
      displayCorners = null;
    }

    // Draw
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (displayCorners) {
      const cw = overlay.width, ch = overlay.height;
      const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
      const coverScale = Math.max(cw / vw, ch / vh);
      const offX = (vw * coverScale - cw) / 2;
      const offY = (vh * coverScale - ch) / 2;
      const sx = (vw / detFrameW) * coverScale;
      const sy = (vh / detFrameH) * coverScale;

      function map(pt) { return { x: pt.x * sx - offX, y: pt.y * sy - offY }; }

      const pts = [map(displayCorners.tl), map(displayCorners.tr), map(displayCorners.br), map(displayCorners.bl)];

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(34,197,94,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#22c55e';
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    overlayRaf = requestAnimationFrame(drawLoop);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  // ── Debug overlay (temporary — remove after iOS fix) ───────────────────
  const dbg = document.createElement('div');
  dbg.style.cssText = 'position:absolute;top:50px;left:10px;right:10px;z-index:9999;background:rgba(0,0,0,0.8);color:#0f0;font:12px monospace;padding:8px;border-radius:6px;pointer-events:none;white-space:pre-wrap;';
  el.appendChild(dbg);
  function debugLog(msg) { dbg.textContent += msg + '\n'; }

  async function startCamera() {
    debugLog('getUserMedia supported: ' + !!navigator.mediaDevices?.getUserMedia);
    if (!navigator.mediaDevices?.getUserMedia) {
      exit();
      onFallback?.();
      return;
    }

    try {
      debugLog('Requesting camera...');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      debugLog('Stream obtained: ' + stream.getTracks().map(t => t.kind + ':' + t.readyState).join(', '));
      debugLog('Track settings: ' + JSON.stringify(stream.getVideoTracks()[0]?.getSettings()));

      video.srcObject = stream;
      debugLog('srcObject set. video.readyState=' + video.readyState);
      debugLog('video size: ' + video.offsetWidth + 'x' + video.offsetHeight);
      debugLog('video computed style: ' + getComputedStyle(video).height + ' x ' + getComputedStyle(video).width);

      // iOS needs loadedmetadata before play
      await new Promise(resolve => {
        video.onloadedmetadata = () => {
          debugLog('loadedmetadata fired. videoW=' + video.videoWidth + ' videoH=' + video.videoHeight);
          resolve();
        };
        setTimeout(() => {
          debugLog('loadedmetadata TIMEOUT (3s). readyState=' + video.readyState + ' videoW=' + video.videoWidth);
          resolve();
        }, 3000);
      });
      debugLog('Calling play()...');
      await video.play();
      debugLog('play() resolved. paused=' + video.paused + ' readyState=' + video.readyState);
      debugLog('Video native: ' + video.videoWidth + 'x' + video.videoHeight);
      debugLog('Video CSS: ' + getComputedStyle(video).width + ' x ' + getComputedStyle(video).height);
      debugLog('Video offset: ' + video.offsetWidth + 'x' + video.offsetHeight);
      syncSize();

      // Start detection + overlay
      detectInterval = setInterval(runDetection, 200);
      overlayRaf = requestAnimationFrame(drawLoop);
      debugLog('Scanner running!');
    } catch (err) {
      debugLog('ERROR: ' + err.message);
      console.warn('[live-scanner] Camera failed:', err);
      exit();
      onFallback?.();
    }
  }

  // ── Torch ─────────────────────────────────────────────────────────────────

  async function setTorch(on) {
    const track = stream?.getVideoTracks()[0];
    if (!track) return false;
    try {
      if (!track.getCapabilities?.().torch) return false;
      await track.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch (_) { return false; }
  }

  // ── Capture ───────────────────────────────────────────────────────────────

  async function onCapture() {
    if (!video.videoWidth) return;
    capBtn.disabled = true;

    // Flash + torch
    const torchOn = await setTorch(true);
    if (torchOn) await new Promise(r => setTimeout(r, 400));

    const flash = document.createElement('div');
    flash.className = 'capture-flash';
    el.appendChild(flash);
    setTimeout(() => flash.remove(), 300);

    // Grab full-res frame
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);

    if (torchOn) setTorch(false);

    try {
      const { scanned } = processImage(c);
      const blob = await new Promise(r => scanned.toBlob(r, 'image/jpeg', 0.85));
      scanned.width = 0; scanned.height = 0;
      if (blob) scannedPages.push(blob);
    } catch (err) {
      console.error('[live-scanner] Capture error:', err);
    }

    c.width = 0; c.height = 0;
    capBtn.disabled = false;
    renderThumbs();
  }

  // ── Thumbnails ────────────────────────────────────────────────────────────

  function renderThumbs() {
    thumbs.innerHTML = '';
    scannedPages.forEach((blob, i) => {
      const url = URL.createObjectURL(blob);
      blobUrls.push(url);

      const wrap = document.createElement('div');
      wrap.className = 'live-scanner__thumb-wrap';

      const img = document.createElement('img');
      img.src = url;
      img.className = 'live-scanner__thumb';

      const rm = document.createElement('button');
      rm.className = 'live-scanner__thumb-remove';
      rm.textContent = '\u00d7';
      rm.addEventListener('click', () => {
        URL.revokeObjectURL(url);
        scannedPages.splice(i, 1);
        renderThumbs();
      });

      wrap.append(img, rm);
      thumbs.appendChild(wrap);
    });
    doneBtn.disabled = scannedPages.length === 0;
  }

  // ── Exit ──────────────────────────────────────────────────────────────────

  function exit() {
    active = false;

    if (detectInterval) { clearInterval(detectInterval); detectInterval = null; }
    if (overlayRaf) { cancelAnimationFrame(overlayRaf); overlayRaf = null; }

    try { video.pause(); video.srcObject = null; } catch (_) {}

    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }

    blobUrls.forEach(u => URL.revokeObjectURL(u));
    blobUrls.length = 0;

    if (el.parentNode) el.remove();
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  closeBtn.addEventListener('click', () => { exit(); onCancel?.(); });
  capBtn.addEventListener('click', onCapture);
  doneBtn.addEventListener('click', () => { const p = [...scannedPages]; exit(); onDone?.(p); });

  // ── Start ─────────────────────────────────────────────────────────────────

  active = true;
  startCamera();
  renderThumbs();
}

/**
 * Image processing pipeline for document scanning — DOM wrapper layer.
 *
 * Re-exports all pure math from scanner-core.js (backward compatible).
 * DOM-dependent functions (Canvas, Image, URL) are defined here.
 *
 * Native ES module. All functions are named exports.
 */

export * from './scanner-core.js';

import {
  detectDocument,
  applyAdaptiveThresholdToArray,
  createProjector,
} from './scanner-core.js';

// ── Projective perspective correction (DOM) ──────────────────────────────────

/**
 * Projective perspective correction using homography matrix.
 * More accurate than bilinear interpolation for non-rectangular quads.
 * @param {HTMLCanvasElement} srcCanvas
 * @param {{tl, tr, br, bl}} corners
 * @returns {HTMLCanvasElement}
 */
export function perspectiveWarp(srcCanvas, corners) {
  const { tl, tr, br, bl } = corners;

  const trueHeight = Math.floor((Math.hypot(bl.x-tl.x, bl.y-tl.y) + Math.hypot(br.x-tr.x, br.y-tr.y)) / 2);
  const trueWidth = Math.floor((Math.hypot(tr.x-tl.x, tr.y-tl.y) + Math.hypot(br.x-bl.x, br.y-bl.y)) / 2);
  const outH = Math.min(trueHeight, 2400);
  const outW = Math.round(trueWidth / trueHeight * outH);

  // Map from output rect → input quad using projective transform
  const projector = createProjector(
    { a: { x: 0, y: outH }, b: { x: 0, y: 0 }, c: { x: outW, y: 0 }, d: { x: outW, y: outH } },
    { a: bl, b: tl, c: tr, d: br }
  );

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d');

  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height).data;
  const outImg = outCtx.createImageData(outW, outH);
  const outData = outImg.data;
  const sw = srcCanvas.width, sh = srcCanvas.height;

  for (let y = 0; y < outH; ++y) {
    for (let x = 0; x < outW; ++x) {
      const pt = projector(x, y);
      const xf = Math.floor(pt.x), yf = Math.floor(pt.y);
      const dBase = (y * outW + x) * 4;
      outData[dBase + 3] = 255;

      if (xf >= 0 && xf < sw - 1 && yf >= 0 && yf < sh - 1) {
        const xt = pt.x - xf, xtr = 1 - xt;
        const yt = pt.y - yf, ytr = 1 - yt;
        const rawBase = (yf * sw + xf) * 4;
        const offSW = sw * 4;
        for (let c = 0; c < 3; ++c) {
          const base = rawBase + c;
          const a = srcData[base] * xtr + srcData[base + 4] * xt;
          const b = srcData[base + offSW] * xtr + srcData[base + offSW + 4] * xt;
          outData[dBase + c] = a * ytr + b * yt;
        }
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return out;
}

// ── Adaptive threshold B&W filter (DOM) ─────────────────────────────────────

export function applyAdaptiveThreshold(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width, h = canvas.height;

  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2]);
  }

  const blockSize = Math.max(25, Math.round(Math.min(w, h) / 16) | 1);
  const C = 15;
  const thresholded = applyAdaptiveThresholdToArray(gray, w, h, blockSize, C);

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    d[idx] = d[idx+1] = d[idx+2] = thresholded[i];
    d[idx+3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

// ── Load image from file ─────────────────────────────────────────────────────

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ── Process image and release canvas memory ──────────────────────────────────

export async function processAndRelease(img) {
  const { scanned } = processImage(img);

  const scannedBlob = await new Promise(resolve =>
    scanned.toBlob(resolve, 'image/jpeg', 0.85)
  );
  scanned.width = 0;
  scanned.height = 0;

  return { scannedBlob };
}

// ── Main processing pipeline ─────────────────────────────────────────────────

export function processImage(img) {
  const work = document.createElement('canvas');
  const wCtx = work.getContext('2d');
  const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
  work.width = Math.round(img.width * scale);
  work.height = Math.round(img.height * scale);
  wCtx.drawImage(img, 0, 0, work.width, work.height);

  // Detect document using Hough Transform pipeline
  const imageData = wCtx.getImageData(0, 0, work.width, work.height);
  const corners = detectDocument(imageData.data, work.width, work.height);

  // Perspective warp if found
  let output;
  if (corners) {
    output = perspectiveWarp(work, corners);
    work.width = 0;
  } else {
    output = work;
  }

  // Apply B&W threshold
  applyAdaptiveThreshold(output);

  return { scanned: output };
}

// ── Exports for review screen (edge detection without full processing) ───────

export function detectEdges(img) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const corners = detectDocument(imageData.data, canvas.width, canvas.height);
  canvas.width = 0;

  return corners;
}

/**
 * Image processing pipeline for document scanning.
 * Extracted from upload.js — handles edge detection, perspective correction,
 * deskew rotation, and adaptive B&W threshold.
 *
 * Native ES module. All functions are named exports.
 */

// ── Gaussian blur (5x5) ──────────────────────────────────────────────────────
export function gaussianBlur(gray, w, h) {
  const kernel = [1, 4, 6, 4, 1, 4, 16, 24, 16, 4, 6, 24, 36, 24, 6, 4, 16, 24, 16, 4, 1, 4, 6, 4, 1];
  const out = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let sum = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          sum += gray[(y + ky) * w + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)];
        }
      }
      out[y * w + x] = sum / 256;
    }
  }
  return out;
}

// ── Sobel edge detection ──────────────────────────────────────────────────────
export function sobelEdges(gray, w, h) {
  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
        -2 * gray[y * w + (x - 1)]   + 2 * gray[y * w + (x + 1)]
        -gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
        +gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      edges[y * w + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
    }
  }
  return edges;
}

// ── Find document corners ─────────────────────────────────────────────────────
export function findDocumentCorners(edges, w, h) {
  const threshold = 50;
  const margin = Math.round(Math.min(w, h) * 0.02);

  const topEdge = [], bottomEdge = [], leftEdge = [], rightEdge = [];

  const cols = 20;
  for (let ci = 0; ci < cols; ci++) {
    const x = Math.round(margin + (w - 2 * margin) * ci / (cols - 1));
    for (let y = margin; y < h / 2; y++) {
      if (edges[y * w + x] > threshold) { topEdge.push({ x, y }); break; }
    }
    for (let y = h - margin - 1; y > h / 2; y--) {
      if (edges[y * w + x] > threshold) { bottomEdge.push({ x, y }); break; }
    }
  }

  const rows = 20;
  for (let ri = 0; ri < rows; ri++) {
    const y = Math.round(margin + (h - 2 * margin) * ri / (rows - 1));
    for (let x = margin; x < w / 2; x++) {
      if (edges[y * w + x] > threshold) { leftEdge.push({ x, y }); break; }
    }
    for (let x = w - margin - 1; x > w / 2; x--) {
      if (edges[y * w + x] > threshold) { rightEdge.push({ x, y }); break; }
    }
  }

  if (topEdge.length < 3 || bottomEdge.length < 3 || leftEdge.length < 3 || rightEdge.length < 3) {
    return null;
  }

  const fitLine = (points) => {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    return { p1: points[0], p2: points[points.length - 1] };
  };

  const top    = fitLine(topEdge);
  const bottom = fitLine(bottomEdge);
  const left   = fitLine(leftEdge);
  const right  = fitLine(rightEdge);

  const intersect = (l1, l2) => {
    const x1 = l1.p1.x, y1 = l1.p1.y, x2 = l1.p2.x, y2 = l1.p2.y;
    const x3 = l2.p1.x, y3 = l2.p1.y, x4 = l2.p2.x, y4 = l2.p2.y;
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(d) < 0.001) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  };

  const tl = intersect(top, left);
  const tr = intersect(top, right);
  const br = intersect(bottom, right);
  const bl = intersect(bottom, left);

  if (!tl || !tr || !br || !bl) return null;

  const allInside = [tl, tr, br, bl].every(p =>
    p.x >= -w * 0.1 && p.x <= w * 1.1 && p.y >= -h * 0.1 && p.y <= h * 1.1
  );
  if (!allInside) return null;

  const quadArea = 0.5 * Math.abs(
    (tr.x - tl.x) * (bl.y - tl.y) - (bl.x - tl.x) * (tr.y - tl.y)
  ) + 0.5 * Math.abs(
    (tr.x - br.x) * (bl.y - br.y) - (bl.x - br.x) * (tr.y - br.y)
  );
  if (quadArea < w * h * 0.15) return null;

  return { tl, tr, br, bl };
}

// ── Perspective warp (with coordinate clamping fix) ───────────────────────────
export function perspectiveWarp(srcCanvas, corners) {
  const { tl, tr, br, bl } = corners;

  const widthTop    = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightLeft  = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);

  const outW = Math.round(Math.max(widthTop, widthBottom));
  const outH = Math.round(Math.max(heightLeft, heightRight));

  const out = document.createElement('canvas');
  out.width  = outW;
  out.height = outH;
  const outCtx = out.getContext('2d');

  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const outData = outCtx.createImageData(outW, outH);

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const u = dx / outW;
      const v = dy / outH;

      const sx = (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x;
      const sy = (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;

      // Clamp coordinates instead of skipping (fixes black-corner bug)
      const cx = Math.max(0, Math.min(srcCanvas.width - 2, x0));
      const cy = Math.max(0, Math.min(srcCanvas.height - 2, y0));

      const idx = (dy * outW + dx) * 4;
      for (let c = 0; c < 3; c++) {
        const p00 = srcData.data[(cy * srcCanvas.width + cx) * 4 + c];
        const p10 = srcData.data[(cy * srcCanvas.width + cx + 1) * 4 + c];
        const p01 = srcData.data[((cy + 1) * srcCanvas.width + cx) * 4 + c];
        const p11 = srcData.data[((cy + 1) * srcCanvas.width + cx + 1) * 4 + c];
        outData.data[idx + c] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
          p01 * (1 - fx) * fy + p11 * fx * fy
        );
      }
      outData.data[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return out;
}

// ── Compute skew angle from detected corners ──────────────────────────────────
export function computeSkewAngle(corners) {
  const dx = corners.tr.x - corners.tl.x;
  const dy = corners.tr.y - corners.tl.y;
  return Math.atan2(dy, dx);
}

// ── Apply rotation for deskew ─────────────────────────────────────────────────
export function applyRotation(canvas, angleRad) {
  if (Math.abs(angleRad) < 0.017) return canvas; // < 1 degree, skip
  const diag = Math.ceil(Math.hypot(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = diag;
  out.height = diag;
  const ctx = out.getContext('2d');
  ctx.translate(diag / 2, diag / 2);
  ctx.rotate(-angleRad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  canvas.width = 0; // release source
  return out;
}

// ── Pure adaptive threshold (no DOM dependency, for testing) ──────────────────
export function applyAdaptiveThresholdToArray(gray, w, h, blockSize, C) {
  const result = new Uint8Array(w * h);

  // Build integral image
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = rowSum + integral[y * (w + 1) + (x + 1)];
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.floor(blockSize / 2);
      const y1 = Math.max(0, y - r);
      const y2 = Math.min(h - 1, y + r);
      const x1 = Math.max(0, x - r);
      const x2 = Math.min(w - 1, x + r);

      const area = (y2 - y1 + 1) * (x2 - x1 + 1);
      const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)]
                - integral[y1 * (w + 1) + (x2 + 1)]
                - integral[(y2 + 1) * (w + 1) + x1]
                + integral[y1 * (w + 1) + x1];
      const mean = sum / area;

      result[y * w + x] = gray[y * w + x] > (mean - C) ? 255 : 0;
    }
  }

  return result;
}

// ── Adaptive threshold applied to canvas (uses pure function internally) ──────
export function applyAdaptiveThreshold(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  // Extract grayscale
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  }

  const blockSize = Math.max(25, Math.round(Math.min(w, h) / 16) | 1);
  const C = 15;
  const thresholded = applyAdaptiveThresholdToArray(gray, w, h, blockSize, C);

  // Write back to canvas image data
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    d[idx] = d[idx + 1] = d[idx + 2] = thresholded[i];
    d[idx + 3] = 255;
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

// ── Process image and release canvas memory ─────────────────────────────────
// Returns { scannedBlob, ocrBlob } — scannedBlob is B&W for PDF, ocrBlob is
// grayscale (no threshold) for OCR text extraction.
export async function processAndRelease(img) {
  const canvas = processImage(img);
  const scannedBlob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
  canvas.width = 0;   // release GPU memory
  canvas.height = 0;

  // Create a lighter version for OCR — just grayscale, no B&W threshold
  const ocrCanvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  ocrCanvas.width = Math.round(img.width * scale);
  ocrCanvas.height = Math.round(img.height * scale);
  const ctx = ocrCanvas.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.3)';
  ctx.drawImage(img, 0, 0, ocrCanvas.width, ocrCanvas.height);
  const ocrBlob = await new Promise(resolve =>
    ocrCanvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
  ocrCanvas.width = 0;
  ocrCanvas.height = 0;

  return { scannedBlob, ocrBlob };
}

// ── Main processing pipeline ──────────────────────────────────────────────────
export function processImage(img) {
  const work = document.createElement('canvas');
  const wCtx = work.getContext('2d');
  // Limit to 2400px max dimension — good quality for A4/letter invoices
  const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
  work.width  = Math.round(img.width * scale);
  work.height = Math.round(img.height * scale);
  wCtx.drawImage(img, 0, 0, work.width, work.height);

  // Get image data
  const imageData = wCtx.getImageData(0, 0, work.width, work.height);
  const w = work.width;
  const h = work.height;

  // Step 1: Grayscale
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = imageData.data[i * 4];
    const g = imageData.data[i * 4 + 1];
    const b = imageData.data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Step 2: Gaussian blur (5x5)
  const blurred = gaussianBlur(gray, w, h);

  // Step 3: Edge detection (Sobel)
  const edges = sobelEdges(blurred, w, h);

  // Step 4: Find document contour
  let corners = findDocumentCorners(edges, w, h);

  // Step 5: Deskew + perspective warp if corners found
  let output;
  if (corners) {
    const angle = computeSkewAngle(corners);
    const rotated = applyRotation(work, angle);

    if (rotated !== work) {
      // Rotation was applied (> 1 degree) — re-detect corners on rotated canvas
      const rCtx = rotated.getContext('2d');
      const rData = rCtx.getImageData(0, 0, rotated.width, rotated.height);
      const rW = rotated.width;
      const rH = rotated.height;

      const rGray = new Uint8Array(rW * rH);
      for (let i = 0; i < rW * rH; i++) {
        const ri = rData.data[i * 4];
        const gi = rData.data[i * 4 + 1];
        const bi = rData.data[i * 4 + 2];
        rGray[i] = Math.round(0.299 * ri + 0.587 * gi + 0.114 * bi);
      }

      const rBlurred = gaussianBlur(rGray, rW, rH);
      const rEdges = sobelEdges(rBlurred, rW, rH);
      const rCorners = findDocumentCorners(rEdges, rW, rH);

      output = rCorners ? perspectiveWarp(rotated, rCorners) : rotated;
    } else {
      // No significant rotation — use original corners
      output = perspectiveWarp(work, corners);
    }
  } else {
    output = work;
  }

  // Step 6: Apply adaptive threshold B&W filter for scanned look
  applyAdaptiveThreshold(output);

  return output;
}

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

// ── Find document corners (legacy margin-scan method) ─────────────────────────
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

// ── Robust contour-based document detection (handles rotated documents) ───────

/** Downsample a grayscale/edge array using area averaging */
export function downsampleEdges(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.round(dx * xRatio));
      const sy = Math.min(srcH - 1, Math.round(dy * yRatio));
      dst[dy * dstW + dx] = src[sy * srcW + sx];
    }
  }
  return dst;
}

/** Morphological dilation on a binary image (1/0 values) */
export function morphDilate(binary, w, h, radius) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (binary[y * w + x]) {
        for (let ky = -radius; ky <= radius; ky++) {
          for (let kx = -radius; kx <= radius; kx++) {
            const nx = x + kx, ny = y + ky;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              out[ny * w + nx] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

/** Flood-fill from image border to find background. Returns Uint8Array (1=background). */
export function floodFillBorder(binary, w, h) {
  const bg = new Uint8Array(w * h);
  const queue = [];

  // Seed from border pixels that are not edge
  for (let x = 0; x < w; x++) {
    if (!binary[x]) { bg[x] = 1; queue.push(x); }
    const bi = (h - 1) * w + x;
    if (!binary[bi]) { bg[bi] = 1; queue.push(bi); }
  }
  for (let y = 1; y < h - 1; y++) {
    if (!binary[y * w]) { bg[y * w] = 1; queue.push(y * w); }
    const ri = y * w + w - 1;
    if (!binary[ri]) { bg[ri] = 1; queue.push(ri); }
  }

  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % w, y = (idx - x) / w;
    const neighbors = [
      x > 0     ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0     ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
    ];
    for (const ni of neighbors) {
      if (ni >= 0 && !bg[ni] && !binary[ni]) {
        bg[ni] = 1;
        queue.push(ni);
      }
    }
  }

  return bg;
}

/** Graham scan convex hull. Returns points in counter-clockwise order. */
export function grahamScan(points) {
  if (points.length < 3) return points.slice();

  // Find the bottom-most (then left-most) point
  let pivot = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y > points[pivot].y ||
       (points[i].y === points[pivot].y && points[i].x < points[pivot].x)) {
      pivot = i;
    }
  }

  const p0 = points[pivot];

  // Sort by polar angle from pivot
  const sorted = points.filter((_, i) => i !== pivot).sort((a, b) => {
    const angleA = Math.atan2(a.y - p0.y, a.x - p0.x);
    const angleB = Math.atan2(b.y - p0.y, b.x - p0.x);
    if (Math.abs(angleA - angleB) > 1e-10) return angleA - angleB;
    // Same angle: closer point first
    const dA = (a.x - p0.x) ** 2 + (a.y - p0.y) ** 2;
    const dB = (b.x - p0.x) ** 2 + (b.y - p0.y) ** 2;
    return dA - dB;
  });

  const stack = [p0];
  for (const pt of sorted) {
    while (stack.length > 1) {
      const a = stack[stack.length - 2];
      const b = stack[stack.length - 1];
      // Cross product: (b-a) x (pt-a)
      const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
      if (cross > 0) break; // left turn — keep
      stack.pop();
    }
    stack.push(pt);
  }

  return stack;
}

/** Shoelace formula for polygon area */
export function shoelaceArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/** Extract 4 corners (TL, TR, BR, BL) from a convex hull */
export function hullToQuad(hull) {
  if (hull.length < 4) return null;

  // TL = min(x+y), BR = max(x+y), TR = max(x-y), BL = min(x-y)
  // Tie-breaking ensures distinct corners even for 45° rotated rectangles.
  let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
  let minSum = Infinity, maxSum = -Infinity;
  let maxDiff = -Infinity, minDiff = Infinity;

  for (const p of hull) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    // TL: min sum, tie-break by smaller y (higher up)
    if (sum < minSum || (sum === minSum && p.y < tl.y)) { minSum = sum; tl = p; }
    // BR: max sum, tie-break by larger y (lower down)
    if (sum > maxSum || (sum === maxSum && p.y > br.y)) { maxSum = sum; br = p; }
    // TR: max diff (x-y), tie-break by larger x (more right)
    if (diff > maxDiff || (diff === maxDiff && p.x > tr.x)) { maxDiff = diff; tr = p; }
    // BL: min diff (x-y), tie-break by smaller x (more left)
    if (diff < minDiff || (diff === minDiff && p.x < bl.x)) { minDiff = diff; bl = p; }
  }

  // Validate that we got 4 distinct corners
  const pts = [tl, tr, br, bl];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (pts[i].x === pts[j].x && pts[i].y === pts[j].y) return null;
    }
  }

  return { tl, tr, br, bl };
}

/**
 * Robust document quad detection using contour analysis.
 * Works for documents at any rotation angle (0-360°).
 * Falls back to legacy margin-scan method if contour detection fails.
 */
export function findDocumentQuadRobust(edges, w, h) {
  // Downsample for performance (max 400px)
  const maxDim = 400;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const small = downsampleEdges(edges, w, h, sw, sh);

  // Binary threshold
  const binary = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) binary[i] = small[i] > 25 ? 1 : 0;

  // Dilate to close edge gaps (crucial for document boundary continuity)
  const dilated = morphDilate(binary, sw, sh, 4);

  // Flood fill from border to find background
  const bg = floodFillBorder(dilated, sw, sh);

  // Interior = everything not reached by background flood fill
  let interiorCount = 0;
  for (let i = 0; i < sw * sh; i++) {
    if (!bg[i]) interiorCount++;
  }

  // Document should occupy at least 10% of image
  if (interiorCount < sw * sh * 0.10) return null;

  // Find boundary points of interior region
  const boundary = [];
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      if (bg[y * sw + x]) continue; // skip background
      // On boundary if any 4-neighbor is background
      if (bg[(y - 1) * sw + x] || bg[(y + 1) * sw + x] ||
          bg[y * sw + x - 1] || bg[y * sw + x + 1]) {
        boundary.push({ x, y });
      }
    }
  }

  if (boundary.length < 4) return null;

  // Convex hull of boundary points
  const hull = grahamScan(boundary);
  if (hull.length < 4) return null;

  // Extract 4 corners from hull
  const quad = hullToQuad(hull);
  if (!quad) return null;

  // Validate quad area (at least 10% of image)
  const quadArea = shoelaceArea([quad.tl, quad.tr, quad.br, quad.bl]);
  if (quadArea < sw * sh * 0.10) return null;

  // Scale corners back to original resolution
  const inv = 1 / scale;
  return {
    tl: { x: quad.tl.x * inv, y: quad.tl.y * inv },
    tr: { x: quad.tr.x * inv, y: quad.tr.y * inv },
    br: { x: quad.br.x * inv, y: quad.br.y * inv },
    bl: { x: quad.bl.x * inv, y: quad.bl.y * inv },
  };
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
  const { scanned, corrected } = processImage(img);
  const scannedBlob = await new Promise(resolve =>
    scanned.toBlob(resolve, 'image/jpeg', 0.85)
  );
  scanned.width = 0;   // release GPU memory
  scanned.height = 0;

  // OCR version: use the perspective-corrected image (not raw) with contrast boost.
  // This ensures rotated documents have upright text for Tesseract.
  const ocrCanvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(corrected.width, corrected.height));
  ocrCanvas.width = Math.round(corrected.width * scale);
  ocrCanvas.height = Math.round(corrected.height * scale);
  const ctx = ocrCanvas.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.3)';
  ctx.drawImage(corrected, 0, 0, ocrCanvas.width, ocrCanvas.height);
  corrected.width = 0;
  corrected.height = 0;

  const ocrBlob = await new Promise(resolve =>
    ocrCanvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
  ocrCanvas.width = 0;
  ocrCanvas.height = 0;

  return { scannedBlob, ocrBlob };
}

// ── Main processing pipeline ──────────────────────────────────────────────────
// Returns { scanned: canvas (B&W), corrected: canvas (grayscale, no threshold) }
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

  // Step 4: Find document contour — try robust contour method first, then legacy
  let corners = findDocumentQuadRobust(edges, w, h) || findDocumentCorners(edges, w, h);

  // Step 5: Perspective warp if corners found (handles any rotation angle)
  let output;
  if (corners) {
    output = perspectiveWarp(work, corners);
    work.width = 0; // release source
  } else {
    output = work;
  }

  // Clone the corrected canvas before B&W threshold (for OCR use)
  const corrected = document.createElement('canvas');
  corrected.width = output.width;
  corrected.height = output.height;
  corrected.getContext('2d').drawImage(output, 0, 0);

  // Step 6: Apply adaptive threshold B&W filter for scanned look
  applyAdaptiveThreshold(output);

  return { scanned: output, corrected };
}

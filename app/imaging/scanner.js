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

// ── Sobel with gradient direction (for Hough Transform) ──────────────────────
export function sobelEdgesWithDirection(gray, w, h) {
  const magnitude = new Uint8Array(w * h);
  const direction = new Float32Array(w * h); // radians [0, π)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
        -2 * gray[y * w + (x - 1)]   + 2 * gray[y * w + (x + 1)]
        -gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
        +gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      const mag = Math.sqrt(gx * gx + gy * gy);
      magnitude[y * w + x] = Math.min(255, mag);
      // Gradient direction — edge direction is perpendicular (rotate 90°)
      let theta = Math.atan2(gy, gx) + Math.PI / 2;
      if (theta < 0) theta += Math.PI;
      if (theta >= Math.PI) theta -= Math.PI;
      direction[y * w + x] = theta;
    }
  }
  return { magnitude, direction };
}

// ── Hough Transform ─────────────────────────────────────────────────────────
// Line parameterization: r = x*cos(θ) + y*sin(θ)
// Uses gradient direction to constrain voting (5x speedup per article)

/** Precomputed sin/cos lookup table for 180 angle bins (1° resolution) */
const _sinTable = new Float32Array(180);
const _cosTable = new Float32Array(180);
for (let i = 0; i < 180; i++) {
  const rad = i * Math.PI / 180;
  _sinTable[i] = Math.sin(rad);
  _cosTable[i] = Math.cos(rad);
}

/**
 * Hough Transform accumulator with gradient-direction-constrained voting.
 * @param {Uint8Array} magnitude - Sobel edge magnitude
 * @param {Float32Array} direction - Sobel edge direction (radians, [0, π))
 * @param {number} w - image width
 * @param {number} h - image height
 * @param {number} [magThreshold=30] - minimum edge magnitude to vote
 * @returns {{ accumulator: Int32Array, numTheta: number, numRho: number, maxRho: number }}
 */
export function houghTransform(magnitude, direction, w, h, magThreshold = 30) {
  const maxRho = Math.ceil(Math.hypot(w, h));
  const numTheta = 180;
  const numRho = maxRho * 2; // [-maxRho, +maxRho] mapped to [0, numRho)
  const accumulator = new Int32Array(numTheta * numRho);
  const angleWindow = 10; // ±10° around perpendicular to gradient

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const mag = magnitude[idx];
      if (mag < magThreshold) continue;

      // Edge direction (perpendicular to gradient) in degrees
      const edgeDeg = Math.round(direction[idx] * 180 / Math.PI);

      // Only vote for angles near the edge direction (±window)
      for (let dt = -angleWindow; dt <= angleWindow; dt++) {
        let thetaIdx = edgeDeg + dt;
        if (thetaIdx < 0) thetaIdx += 180;
        if (thetaIdx >= 180) thetaIdx -= 180;

        const r = Math.round(x * _cosTable[thetaIdx] + y * _sinTable[thetaIdx]);
        const rhoIdx = r + maxRho;
        if (rhoIdx >= 0 && rhoIdx < numRho) {
          accumulator[thetaIdx * numRho + rhoIdx] += mag;
        }
      }
    }
  }

  return { accumulator, numTheta, numRho, maxRho };
}

/**
 * Non-maximum suppression on Hough accumulator — find top N lines.
 * @param {{ accumulator: Int32Array, numTheta: number, numRho: number, maxRho: number }} hough
 * @param {number} [topN=20] - number of lines to return
 * @param {number} [suppressRadius=10] - suppression window in accumulator space
 * @returns {Array<{theta: number, rho: number, votes: number}>} Lines sorted by vote count
 */
export function houghPeaks(hough, topN = 20, suppressRadius = 10) {
  const { accumulator, numTheta, numRho, maxRho } = hough;
  const peaks = [];
  // Copy accumulator so we can suppress in-place
  const acc = Int32Array.from(accumulator);

  for (let n = 0; n < topN; n++) {
    // Find global max
    let maxVal = 0, maxIdx = 0;
    for (let i = 0; i < acc.length; i++) {
      if (acc[i] > maxVal) { maxVal = acc[i]; maxIdx = i; }
    }
    if (maxVal === 0) break;

    const thetaIdx = Math.floor(maxIdx / numRho);
    const rhoIdx = maxIdx % numRho;
    peaks.push({
      theta: thetaIdx * Math.PI / 180,
      rho: rhoIdx - maxRho,
      votes: maxVal,
    });

    // Suppress neighborhood
    for (let dt = -suppressRadius; dt <= suppressRadius; dt++) {
      for (let dr = -suppressRadius; dr <= suppressRadius; dr++) {
        let ti = thetaIdx + dt;
        const ri = rhoIdx + dr;
        if (ti < 0) ti += numTheta;
        if (ti >= numTheta) ti -= numTheta;
        if (ri >= 0 && ri < numRho) {
          acc[ti * numRho + ri] = 0;
        }
      }
    }
  }

  return peaks;
}

/**
 * Cluster similar lines — merge lines with close (theta, rho) values.
 * @param {Array<{theta: number, rho: number, votes: number}>} lines
 * @param {number} [thetaTol=0.1] - angle tolerance in radians (~6°)
 * @param {number} [rhoTol=20] - distance tolerance in pixels
 * @returns {Array<{theta: number, rho: number, votes: number}>}
 */
export function clusterLines(lines, thetaTol = 0.1, rhoTol = 20) {
  const used = new Uint8Array(lines.length);
  const clusters = [];

  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let sumTheta = lines[i].theta * lines[i].votes;
    let sumRho = lines[i].rho * lines[i].votes;
    let sumVotes = lines[i].votes;

    for (let j = i + 1; j < lines.length; j++) {
      if (used[j]) continue;
      const dTheta = Math.abs(lines[i].theta - lines[j].theta);
      const dRho = Math.abs(lines[i].rho - lines[j].rho);
      // Handle theta wrapping near 0/π
      const dThetaW = Math.min(dTheta, Math.PI - dTheta);
      if (dThetaW < thetaTol && dRho < rhoTol) {
        used[j] = 1;
        sumTheta += lines[j].theta * lines[j].votes;
        sumRho += lines[j].rho * lines[j].votes;
        sumVotes += lines[j].votes;
      }
    }

    clusters.push({
      theta: sumTheta / sumVotes,
      rho: sumRho / sumVotes,
      votes: sumVotes,
    });
  }

  return clusters;
}

/**
 * Intersect two Hough lines (theta, rho) → point {x, y}.
 * Returns null if lines are nearly parallel.
 */
export function intersectHoughLines(l1, l2) {
  const cos1 = Math.cos(l1.theta), sin1 = Math.sin(l1.theta);
  const cos2 = Math.cos(l2.theta), sin2 = Math.sin(l2.theta);
  const det = cos1 * sin2 - cos2 * sin1;
  if (Math.abs(det) < 1e-6) return null; // parallel
  return {
    x: (l1.rho * sin2 - l2.rho * sin1) / det,
    y: (l2.rho * cos1 - l1.rho * cos2) / det,
  };
}

/**
 * Score a quadrilateral for geometric validity as a document.
 * Higher = better. Returns 0 for invalid quads.
 * @param {{tl, tr, br, bl}} quad - four corner points
 * @param {number} w - image width
 * @param {number} h - image height
 * @returns {number} score (0 = invalid)
 */
export function scoreQuad(quad, w, h) {
  const { tl, tr, br, bl } = quad;
  const pts = [tl, tr, br, bl];

  // All corners must be within image bounds (with 10% margin)
  for (const p of pts) {
    if (p.x < -w * 0.1 || p.x > w * 1.1 || p.y < -h * 0.1 || p.y > h * 1.1) return 0;
  }

  // Must be convex (all cross products same sign)
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const c1 = cross(tl, tr, br);
  const c2 = cross(tr, br, bl);
  const c3 = cross(br, bl, tl);
  const c4 = cross(bl, tl, tr);
  if (!(c1 < 0 && c2 < 0 && c3 < 0 && c4 < 0) && !(c1 > 0 && c2 > 0 && c3 > 0 && c4 > 0)) return 0;

  // Area check (at least 10% of image, at most 98%)
  const area = shoelaceArea(pts);
  const imgArea = w * h;
  if (area < imgArea * 0.10 || area > imgArea * 0.98) return 0;

  // Aspect ratio penalty — documents are typically between 1:1 and 1:2
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBot = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightL = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightR = Math.hypot(br.x - tr.x, br.y - tr.y);
  const avgW = (widthTop + widthBot) / 2;
  const avgH = (heightL + heightR) / 2;
  const aspect = Math.max(avgW, avgH) / Math.min(avgW, avgH);
  if (aspect > 3) return 0; // too elongated

  // Score: area coverage * regularity * aspect bonus
  const areaCoverage = area / imgArea;
  const widthRatio = Math.min(widthTop, widthBot) / Math.max(widthTop, widthBot);
  const heightRatio = Math.min(heightL, heightR) / Math.max(heightL, heightR);
  const regularity = widthRatio * heightRatio; // 1.0 for perfect rectangles

  return areaCoverage * regularity * (1 / aspect);
}

/**
 * Find the best document quadrilateral from Hough lines.
 * Tries all combinations of 4 lines, computes intersections, scores quads.
 * @param {Array<{theta: number, rho: number, votes: number}>} lines - clustered Hough lines
 * @param {number} w - image width
 * @param {number} h - image height
 * @returns {{tl, tr, br, bl}|null}
 */
export function findBestQuadFromLines(lines, w, h) {
  if (lines.length < 4) return null;

  // Separate into roughly horizontal and roughly vertical lines
  // Horizontal: theta near 90° (π/2), Vertical: theta near 0° or 180°
  const horizontal = [];
  const vertical = [];
  for (const l of lines) {
    const deg = l.theta * 180 / Math.PI;
    if (deg > 30 && deg < 150) horizontal.push(l);
    else vertical.push(l);
  }

  if (horizontal.length < 2 || vertical.length < 2) {
    // Can't form a quad — fall back to brute force over top lines
    return _bruteForceQuad(lines.slice(0, 8), w, h);
  }

  // Sort by votes descending
  horizontal.sort((a, b) => b.votes - a.votes);
  vertical.sort((a, b) => b.votes - a.votes);

  // Try combinations of 2 horizontal + 2 vertical (top candidates)
  let bestQuad = null;
  let bestScore = 0;
  const hCandidates = horizontal.slice(0, 4);
  const vCandidates = vertical.slice(0, 4);

  for (let hi = 0; hi < hCandidates.length; hi++) {
    for (let hj = hi + 1; hj < hCandidates.length; hj++) {
      for (let vi = 0; vi < vCandidates.length; vi++) {
        for (let vj = vi + 1; vj < vCandidates.length; vj++) {
          const h1 = hCandidates[hi], h2 = hCandidates[hj];
          const v1 = vCandidates[vi], v2 = vCandidates[vj];

          // 4 intersections
          const p1 = intersectHoughLines(h1, v1);
          const p2 = intersectHoughLines(h1, v2);
          const p3 = intersectHoughLines(h2, v1);
          const p4 = intersectHoughLines(h2, v2);
          if (!p1 || !p2 || !p3 || !p4) continue;

          // Assign to TL/TR/BR/BL using sum/diff heuristic
          const quad = hullToQuad([p1, p2, p3, p4]);
          if (!quad) continue;

          const score = scoreQuad(quad, w, h);
          if (score > bestScore) {
            bestScore = score;
            bestQuad = quad;
          }
        }
      }
    }
  }

  return bestQuad;
}

/** Brute-force: try all 4-line combos from top lines */
function _bruteForceQuad(lines, w, h) {
  let bestQuad = null;
  let bestScore = 0;
  const n = lines.length;

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          const four = [lines[a], lines[b], lines[c], lines[d]];
          // Try all 3 ways to pair 4 lines into 2+2
          const pairings = [
            [[four[0], four[1]], [four[2], four[3]]],
            [[four[0], four[2]], [four[1], four[3]]],
            [[four[0], four[3]], [four[1], four[2]]],
          ];
          for (const [pair1, pair2] of pairings) {
            const pts = [];
            for (const l1 of pair1) {
              for (const l2 of pair2) {
                const p = intersectHoughLines(l1, l2);
                if (p) pts.push(p);
              }
            }
            if (pts.length !== 4) continue;
            const quad = hullToQuad(pts);
            if (!quad) continue;
            const score = scoreQuad(quad, w, h);
            if (score > bestScore) { bestScore = score; bestQuad = quad; }
          }
        }
      }
    }
  }

  return bestQuad;
}

/**
 * Hough Transform-based document quad detection.
 * The primary detection method — more robust than edge scanning for
 * finding straight document boundaries in cluttered backgrounds.
 * @param {Uint8Array} gray - grayscale image
 * @param {number} w - image width
 * @param {number} h - image height
 * @returns {{tl, tr, br, bl}|null}
 */
export function findDocumentQuadHough(gray, w, h) {
  // Downsample for performance (max 500px dimension)
  const maxDim = 500;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);

  let smallGray;
  if (scale < 1) {
    smallGray = new Uint8Array(sw * sh);
    const xR = w / sw, yR = h / sh;
    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        smallGray[sy * sw + sx] = gray[Math.min(h - 1, Math.round(sy * yR)) * w + Math.min(w - 1, Math.round(sx * xR))];
      }
    }
  } else {
    smallGray = gray;
  }

  // Blur → Sobel with direction → Hough → peaks → cluster → best quad
  const blurred = gaussianBlur(smallGray, sw, sh);
  const { magnitude, direction } = sobelEdgesWithDirection(blurred, sw, sh);
  const hough = houghTransform(magnitude, direction, sw, sh, 30);
  const peaks = houghPeaks(hough, 20, 10);
  const lines = clusterLines(peaks, 0.1, 15);
  const quad = findBestQuadFromLines(lines, sw, sh);

  if (!quad) return null;

  // Scale back to original resolution
  const inv = 1 / scale;
  return {
    tl: { x: quad.tl.x * inv, y: quad.tl.y * inv },
    tr: { x: quad.tr.x * inv, y: quad.tr.y * inv },
    br: { x: quad.br.x * inv, y: quad.br.y * inv },
    bl: { x: quad.bl.x * inv, y: quad.bl.y * inv },
  };
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

  // Step 4: Find document contour — Hough (best), contour (fallback), legacy (last resort)
  let corners = findDocumentQuadHough(gray, w, h)
    || findDocumentQuadRobust(edges, w, h)
    || findDocumentCorners(edges, w, h);

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

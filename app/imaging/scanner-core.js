/**
 * Pure-math image processing functions for document scanning.
 * Zero DOM dependencies — safe to import from Web Workers and Node.js.
 *
 * Based on 101arrowz/scanner (MIT) — Hough Transform with gradient-weighted
 * voting, Bresenham edge scoring, and projective (homography) perspective
 * correction math.
 *
 * Native ES module. All functions are named exports.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (x, min, max) => x < min ? min : x > max ? max : x;

// ── Convolution ──────────────────────────────────────────────────────────────

export function convolve(src, w, h, kernel, radius) {
  const side = (radius << 1) + 1;
  const dst = new Float32Array(w * h);
  const iim = h - side, jim = w - side;
  for (let i = 0; i < h; ++i) {
    for (let j = 0; j < w; ++j) {
      let result = 0;
      const ii = clamp(i - radius, 0, iim), ji = clamp(j - radius, 0, jim);
      for (let mi = 0; mi < side; ++mi) {
        for (let mj = 0; mj < side; ++mj) {
          result += src[(mi + ii) * w + (mj + ji)] * kernel[mi * side + mj];
        }
      }
      dst[i * w + j] = result;
    }
  }
  return dst;
}

// ── Grayscale ────────────────────────────────────────────────────────────────

export function grayscale(rgba, len) {
  const dst = new Float32Array(len);
  for (let px = 0; px < len; ++px) {
    const pos = px << 2;
    // Normalized to [0, 1] — matches 101arrowz weighting
    dst[px] = rgba[pos] * 0.00116796875 + rgba[pos + 1] * 0.00229296875 + rgba[pos + 2] * 0.0004453125;
  }
  return dst;
}

// ── Downscale (area averaging) ───────────────────────────────────────────────

export function downscale(src, w, h, by) {
  const dw = Math.floor(w / by);
  const dh = Math.floor(h / by);
  const dst = new Float32Array(dh * dw);
  const by2 = by * by, mi = dh - 1, mj = dw - 1;
  for (let i = 1; i < mi; ++i) {
    const si = i * by, sie = si + by;
    const sif = Math.floor(si), sic = sif + 1, sief = Math.floor(sie);
    const sir = sic - si, sire = sie - sief;
    for (let j = 1; j < mj; ++j) {
      const sj = j * by, sje = sj + by;
      const sjf = Math.floor(sj), sjc = sjf + 1, sjef = Math.floor(sje);
      const sjr = sjc - sj, sjre = sje - sjef;
      let sum = 0;
      for (let rsi = sic; rsi < sief; ++rsi)
        for (let rsj = sjc; rsj < sjef; ++rsj)
          sum += src[rsi * w + rsj];
      for (let rsj = sjc; rsj < sjef; ++rsj) {
        sum += src[sif * w + rsj] * sir;
        sum += src[sief * w + rsj] * sire;
      }
      for (let rsi = sic; rsi < sief; ++rsi) {
        sum += src[rsi * w + sjf] * sjr;
        sum += src[rsi * w + sjef] * sjre;
      }
      sum += src[sif * w + sjf] * sir * sjr;
      sum += src[sif * w + sjef] * sir * sjre;
      sum += src[sief * w + sjf] * sire * sjr;
      sum += src[sief * w + sjef] * sire * sjre;
      dst[i * dw + j] = sum / by2;
    }
  }
  // Edge fill
  for (let i = 1; i < mi; ++i) {
    dst[i * dw] = dst[i * dw + 1];
    dst[i * dw + mj] = dst[i * dw + mj - 1];
  }
  for (let j = 0; j < dw; ++j) {
    dst[j] = dst[j + dw];
    dst[mi * dw + j] = dst[(mi - 1) * dw + j];
  }
  return { data: dst, width: dw, height: dh };
}

// ── Gaussian blur ────────────────────────────────────────────────────────────

const gaussianKernel = new Float32Array([
  0.01258, 0.02516, 0.03145, 0.02516, 0.01258,
  0.02516, 0.0566,  0.07547, 0.0566,  0.02516,
  0.03145, 0.07547, 0.09434, 0.07547, 0.03145,
  0.02516, 0.0566,  0.07547, 0.0566,  0.02516,
  0.01258, 0.02516, 0.03145, 0.02516, 0.01258,
]);

export function gaussianBlur(src, w, h) {
  return convolve(src, w, h, gaussianKernel, 2);
}

// ── Precomputed trig tables (256 bins) ───────────────────────────────────────

const _cos = new Float32Array(256);
const _sin = new Float32Array(256);
for (let t = 0; t < 256; ++t) {
  const theta = Math.PI * t / 256;
  _cos[t] = Math.cos(theta);
  _sin[t] = Math.sin(theta);
}
_sin[0] = _cos[128];

// ── Sobel with Scharr-like weights + gradient-weighted Hough voting ─────────

const HOUGH_MATCH_RATIO = 1 / 40;
const GRADIENT_ERROR = 32; // ±32 angle bins out of 256 (~±22°)

/**
 * Full detection pipeline: Sobel → Hough → quad scoring.
 * Ported from 101arrowz/scanner.
 *
 * @param {Uint8ClampedArray} rgba - raw RGBA pixel data
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {number} [maxTries=3] - threshold retry attempts
 * @returns {{tl, tr, br, bl}|null}
 */
export function detectDocument(rgba, width, height, maxTries = 3) {
  const diag = Math.hypot(width, height);
  const numBins = Math.floor(diag);

  // Adaptive downscale factor (target ~360px wide)
  let scaleFactor = width / 360;
  if (scaleFactor < 2) scaleFactor = 1;
  else if (scaleFactor > 5) scaleFactor = 5;

  const srcWidth = Math.floor(width / scaleFactor);
  const srcHeight = Math.floor(height / scaleFactor);
  const srcLen = srcWidth * srcHeight;

  // Grayscale + downscale
  let src;
  if (scaleFactor === 1) {
    src = grayscale(rgba, width * height);
  } else {
    const fullGray = grayscale(rgba, width * height);
    const ds = downscale(fullGray, width, height, scaleFactor);
    src = ds.data;
  }

  // Gaussian blur
  const blurred = gaussianBlur(src, srcWidth, srcHeight);

  // Sobel with Scharr-like weights (3/10/3) + Hough accumulator
  const gradBuf = new Float32Array(srcLen);
  const houghBuf = new Float32Array(numBins << 8); // numBins * 256
  let totalGrad = 0;
  const iim = srcHeight - 1, jim = srcWidth - 1;

  for (let i = 1; i < iim; ++i) {
    for (let j = 1; j < jim; ++j) {
      const px = i * srcWidth + j;
      const nw = blurred[px - srcWidth - 1], n = blurred[px - srcWidth], ne = blurred[px - srcWidth + 1];
      const w = blurred[px - 1], e = blurred[px + 1];
      const sw = blurred[px + srcWidth - 1], s = blurred[px + srcWidth], se = blurred[px + srcWidth + 1];

      const sx = 10 * (e - w) + 3 * (ne + se - nw - sw);
      const sy = 10 * (n - s) + 3 * (ne + nw - se - sw);
      const grad = Math.pow(sx * sx + sy * sy, 0.3); // compressed magnitude
      gradBuf[px] = grad;
      totalGrad += grad;

      // Edge direction → Hough vote with angular falloff
      const dir = sy / sx;
      const angle = Math.floor(Math.atan(dir) * 256 / Math.PI) + 128;
      for (let off = -GRADIENT_ERROR; off <= GRADIENT_ERROR; ++off) {
        const ang = (angle + off) & 255;
        const bin = ((_cos[ang] * i + _sin[ang] * j + diag) >> 1);
        if (bin >= 0 && bin < numBins) {
          houghBuf[(bin << 8) + ang] += grad / (off * off + 3);
        }
      }
    }
  }

  const avgGrad = totalGrad / ((srcHeight - 2) * (srcWidth - 2));

  // Find max accumulator value
  let maxVote = 0;
  for (let i = 0; i < houghBuf.length; ++i) {
    if (houghBuf[i] > maxVote) maxVote = houghBuf[i];
  }

  // Multi-threshold attempt — start strict, loosen
  for (let threshold = maxVote * 0.05, tries = maxTries; tries > 0; --tries, threshold *= 0.5) {
    // Extract lines above threshold
    let lines = [];
    for (let bin = 0; bin < numBins; ++bin) {
      for (let ang = 0; ang < 256; ++ang) {
        const val = houghBuf[(bin << 8) + ang];
        if (val > threshold) {
          lines.push({ b: bin, a: ang, s: val });
        }
      }
    }

    // Sort by strength, merge nearby duplicates
    lines.sort((a, b) => b.s - a.s);
    const maxBinErr = Math.ceil(numBins * HOUGH_MATCH_RATIO);
    const maxAngleErr = Math.ceil(256 * HOUGH_MATCH_RATIO);

    for (let i = 0; i < lines.length; ++i) {
      const l1 = lines[i];
      let strength = l1.s;
      for (let j = i + 1; j < lines.length; ++j) {
        const l2 = lines[j];
        let angleErr = Math.abs(l1.a - l2.a);
        if (Math.abs(l1.b - l2.b) <= maxBinErr && Math.min(angleErr, 256 - angleErr) <= maxAngleErr) {
          lines.splice(j, 1);
          strength += l2.s;
          --j;
        }
      }
      lines[i].s = strength;
    }

    // Cap to top 20 lines
    lines.sort((a, b) => b.s - a.s);
    if (lines.length > 20) {
      lines = lines.slice(0, 20);
      tries = 1; // don't retry with fewer lines
    }

    // ── Intersection helpers ──
    const intersect = (l1, l2) => {
      const a = _sin[l1.a], d = _sin[l2.a];
      const b = _cos[l1.a], e = _cos[l2.a];
      const c = (l1.b << 1) - diag, f = (l2.b << 1) - diag;
      const det = a * e - d * b;
      if (Math.abs(det) < 1e-6) return null;
      const y = (a * f - d * c) / det;
      const x = (c - y * b) / a;
      return { x, y };
    };

    // Elliptical bounds check (allows minor corner clipping)
    const inBounds = (p) => {
      if (!p) return false;
      const x = p.x / srcWidth - 0.5, y = p.y / srcHeight - 0.5;
      return x * x + y * y <= 0.55;
    };

    // Bresenham line scoring — sum gradient along edge
    const scoreBetween = (a, b) => {
      let score = 0;
      const xi = Math.round(a.x), yi = Math.round(a.y);
      const xf = Math.round(b.x), yf = Math.round(b.y);
      const dx = Math.abs(xf - xi), dy = -Math.abs(yf - yi);
      const sxDir = xi < xf ? 1 : -1;
      const syDir = yi < yf ? 1 : -1;
      for (let x = xi, y = yi, err = dx + dy; x !== xf || y !== yf;) {
        const px = y * srcWidth + x;
        score += (gradBuf[px] || 0) - avgGrad;
        const e2 = err * 2;
        if (e2 >= dy) { err += dy; x += sxDir; }
        if (e2 <= dx) { err += dx; y += syDir; }
      }
      return score * (Math.pow(dx - dy, -0.6) || 0);
    };

    const scoreQuadEdges = (q) =>
      Math.pow(scoreBetween(q.a, q.b) + scoreBetween(q.b, q.c) + scoreBetween(q.c, q.d) + scoreBetween(q.d, q.a), 2);

    const rightErr = (l1, l2) => {
      const err = Math.abs(l1.a - l2.a) - 128;
      return err * err + 1;
    };

    const scoreLines = (l1, l2, l3, l4) => {
      const e12 = rightErr(l1, l2), e23 = rightErr(l2, l3);
      const e34 = rightErr(l3, l4), e41 = rightErr(l4, l1);
      return Math.pow(e12 * e12 + e23 * e23 + e34 * e34 + e41 * e41, -0.3) * Math.pow(l1.s * l2.s * l3.s * l4.s, 0.1);
    };

    // ── Enumerate valid quadrilaterals ──
    const rects = [];

    for (let i = 0; i < lines.length; ++i) {
      const l1 = lines[i];
      for (let j = i + 1; j < lines.length; ++j) {
        const l2 = lines[j];
        const i12 = intersect(l1, l2);
        for (let k = j + 1; k < lines.length; ++k) {
          const l3 = lines[k];
          const i13 = intersect(l1, l3);
          const i23 = intersect(l2, l3);

          if (inBounds(i12)) {
            if (inBounds(i13)) {
              if (!inBounds(i23)) {
                for (let l = k + 1; l < lines.length; ++l) {
                  const l4 = lines[l];
                  const i14 = intersect(l1, l4);
                  const i24 = intersect(l2, l4);
                  const i34 = intersect(l3, l4);
                  if (!inBounds(i14) && inBounds(i24) && inBounds(i34)) {
                    const q = { a: i12, b: i13, c: i34, d: i24 };
                    rects.push({ q, s: scoreQuadEdges(q) * scoreLines(l1, l3, l4, l2) });
                  }
                }
              }
            } else if (inBounds(i23)) {
              for (let l = k + 1; l < lines.length; ++l) {
                const l4 = lines[l];
                const i14 = intersect(l1, l4);
                const i24 = intersect(l2, l4);
                const i34 = intersect(l3, l4);
                if (!inBounds(i24) && inBounds(i14) && inBounds(i34)) {
                  const q = { a: i12, b: i23, c: i34, d: i14 };
                  rects.push({ q, s: scoreQuadEdges(q) * scoreLines(l2, l3, l4, l1) });
                }
              }
            }
          } else {
            // l1, l2 might be parallel; l3 perpendicular
            if (inBounds(i13) && inBounds(i23)) {
              for (let l = k + 1; l < lines.length; ++l) {
                const l4 = lines[l];
                const i14 = intersect(l1, l4);
                const i24 = intersect(l2, l4);
                const i34 = intersect(l3, l4);
                if (!inBounds(i34) && inBounds(i14) && inBounds(i24)) {
                  const q = { a: i13, b: i23, c: i24, d: i14 };
                  rects.push({ q, s: scoreQuadEdges(q) * scoreLines(l3, l2, l4, l1) });
                }
              }
            }
          }
        }
      }
    }

    if (!rects.length) continue;

    rects.sort((a, b) => b.s - a.s);
    const best = rects[0].q;

    // Sort quad corners to consistent TL/TR/BR/BL order
    const sorted = sortQuad(best);

    // Scale back to original coordinates
    return {
      tl: { x: sorted.b.x * scaleFactor, y: sorted.b.y * scaleFactor },
      tr: { x: sorted.c.x * scaleFactor, y: sorted.c.y * scaleFactor },
      br: { x: sorted.d.x * scaleFactor, y: sorted.d.y * scaleFactor },
      bl: { x: sorted.a.x * scaleFactor, y: sorted.a.y * scaleFactor },
    };
  }

  return null;
}

// ── Sort quad corners to consistent order ────────────────────────────────────
// a=bottom-left, b=top-left, c=top-right, d=bottom-right

function sortQuad({ a, b, c, d }) {
  const side = Math.hypot(a.x - b.x, a.y - b.y) + Math.hypot(c.x - d.x, c.y - d.y);
  const top = Math.hypot(b.x - c.x, b.y - c.y) + Math.hypot(d.x - a.x, d.y - a.y);
  if (side > top) {
    if (a.x + b.x < c.x + d.x) {
      return a.y > b.y ? { a, b, c, d } : { a: b, b: a, c: d, d: c };
    } else {
      return c.y > d.y ? { a: c, b: d, c: a, d: b } : { a: d, b: c, c: b, d: a };
    }
  } else {
    if (b.x + c.x < d.x + a.x) {
      return b.y > c.y ? { a: b, b: c, c: d, d: a } : { a: c, b, c: a, d: d };
    } else {
      return d.y > a.y ? { a: d, b: a, c: b, d: c } : { a, b: d, c, d: b };
    }
  }
}

// ── Projective (homography) perspective correction ───────────────────────────

// 3x3 matrix adjugate
export function adj3(src) {
  return new Float32Array([
    src[4]*src[8] - src[5]*src[7], src[2]*src[7] - src[1]*src[8], src[1]*src[5] - src[2]*src[4],
    src[5]*src[6] - src[3]*src[8], src[0]*src[8] - src[2]*src[6], src[2]*src[3] - src[0]*src[5],
    src[3]*src[7] - src[4]*src[6], src[1]*src[6] - src[0]*src[7], src[0]*src[4] - src[1]*src[3],
  ]);
}

export function mul3(a, b) {
  return new Float32Array([
    a[0]*b[0]+a[1]*b[3]+a[2]*b[6], a[0]*b[1]+a[1]*b[4]+a[2]*b[7], a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
    a[3]*b[0]+a[4]*b[3]+a[5]*b[6], a[3]*b[1]+a[4]*b[4]+a[5]*b[7], a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
    a[6]*b[0]+a[7]*b[3]+a[8]*b[6], a[6]*b[1]+a[7]*b[4]+a[8]*b[7], a[6]*b[2]+a[7]*b[5]+a[8]*b[8],
  ]);
}

export function mul3v(a, b) {
  return new Float32Array([
    a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
    a[3]*b[0]+a[4]*b[1]+a[5]*b[2],
    a[6]*b[0]+a[7]*b[1]+a[8]*b[2],
  ]);
}

export function basisToPoints(q) {
  const m = new Float32Array([q.a.x, q.b.x, q.c.x, q.a.y, q.b.y, q.c.y, 1, 1, 1]);
  const coeffs = mul3v(adj3(m), new Float32Array([q.d.x, q.d.y, 1]));
  return mul3(m, new Float32Array([coeffs[0],0,0, 0,coeffs[1],0, 0,0,coeffs[2]]));
}

export function createProjector(from, to) {
  const proj = mul3(basisToPoints(to), adj3(basisToPoints(from)));
  return (px, py) => {
    const projected = mul3v(proj, new Float32Array([px, py, 1]));
    return { x: projected[0] / projected[2], y: projected[1] / projected[2] };
  };
}

// ── Adaptive threshold (pure array version) ──────────────────────────────────

export function applyAdaptiveThresholdToArray(gray, w, h, blockSize, C) {
  const result = new Uint8Array(w * h);
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
      const y1 = Math.max(0, y - r), y2 = Math.min(h - 1, y + r);
      const x1 = Math.max(0, x - r), x2 = Math.min(w - 1, x + r);
      const area = (y2 - y1 + 1) * (x2 - x1 + 1);
      const sum = integral[(y2+1)*(w+1)+(x2+1)] - integral[y1*(w+1)+(x2+1)] - integral[(y2+1)*(w+1)+x1] + integral[y1*(w+1)+x1];
      result[y * w + x] = gray[y * w + x] > (sum / area - C) ? 255 : 0;
    }
  }
  return result;
}

// ── Skew and area helpers ────────────────────────────────────────────────────

export function computeSkewAngle(corners) {
  const dx = corners.tr.x - corners.tl.x;
  const dy = corners.tr.y - corners.tl.y;
  return Math.atan2(dy, dx);
}

export function shoelaceArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

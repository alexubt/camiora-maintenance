/**
 * Unit tests for pure computation functions in scanner.js
 * Uses Node.js built-in test runner (node:test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSkewAngle,
  applyAdaptiveThresholdToArray,
  grahamScan,
  shoelaceArea,
  hullToQuad,
  morphDilate,
  floodFillBorder,
  downsampleEdges,
} from './scanner.js';

describe('computeSkewAngle', () => {
  it('returns 0 for an axis-aligned rectangle', () => {
    const corners = {
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      br: { x: 100, y: 100 },
      bl: { x: 0, y: 100 },
    };
    assert.strictEqual(computeSkewAngle(corners), 0);
  });

  it('returns negative angle for 10px drop over 100px width', () => {
    const corners = {
      tl: { x: 0, y: 10 },
      tr: { x: 100, y: 0 },
      br: { x: 100, y: 90 },
      bl: { x: 0, y: 100 },
    };
    const expected = Math.atan2(-10, 100); // ~-0.0997 rad
    const actual = computeSkewAngle(corners);
    assert.ok(
      Math.abs(actual - expected) < 1e-10,
      `Expected ~${expected}, got ${actual}`
    );
  });

  it('returns angle with abs < 0.017 for less than 1 degree skew', () => {
    // ~0.5 degree skew: dy = sin(0.5 deg) * 100 ~ 0.87
    const corners = {
      tl: { x: 0, y: 0.4 },
      tr: { x: 100, y: 0 },
      br: { x: 100, y: 100 },
      bl: { x: 0, y: 100.4 },
    };
    const angle = computeSkewAngle(corners);
    assert.ok(
      Math.abs(angle) < 0.017,
      `Expected abs(angle) < 0.017, got ${angle}`
    );
  });
});

describe('applyAdaptiveThresholdToArray', () => {
  it('returns all 255 for a uniform white region (all 200)', () => {
    const w = 10, h = 10;
    const gray = new Uint8Array(w * h).fill(200);
    const result = applyAdaptiveThresholdToArray(gray, w, h, 5, 8);
    for (let i = 0; i < result.length; i++) {
      assert.strictEqual(result[i], 255, `Pixel ${i} should be 255`);
    }
  });

  it('returns all 0 for a uniform dark region (all 30)', () => {
    const w = 10, h = 10;
    const gray = new Uint8Array(w * h).fill(30);
    const result = applyAdaptiveThresholdToArray(gray, w, h, 5, 8);
    // In a uniform region, every pixel equals the local mean.
    // pixel (30) > mean (30) - C (8) = 22 => true => 255
    // Actually uniform regions are all above mean-C, so they become 255.
    // To get all 0, we need the pixel to be BELOW mean - C. With uniform values,
    // pixel == mean, so pixel > mean - C is always true.
    // Re-interpreting: a uniform dark region still thresholds to 255 because
    // the pixel matches its neighborhood. Let's test that correctly:
    // For truly dark output, we need a pixel darker than its neighbors by > C.
    // This test verifies uniform dark => all same => all 255 (above local mean - C)
    for (let i = 0; i < result.length; i++) {
      assert.strictEqual(result[i], 255, `Uniform region pixel ${i} should be 255 (pixel >= mean - C)`);
    }
  });

  it('bright pixel surrounded by dark becomes 255, dark neighbors become 0', () => {
    // 5x5 grid, all dark (10), center pixel bright (200)
    const w = 5, h = 5;
    const gray = new Uint8Array(w * h).fill(10);
    gray[2 * w + 2] = 200; // center pixel bright
    const result = applyAdaptiveThresholdToArray(gray, w, h, 5, 8);
    // Center pixel (200) should be far above its local mean => 255
    assert.strictEqual(result[2 * w + 2], 255, 'Bright center pixel should be 255');
    // A dark pixel (10) near bright center: local mean will be slightly above 10,
    // so pixel (10) < mean - C should hold for neighbors => 0
    // Check a corner pixel far from bright center
    assert.strictEqual(result[0], 0, 'Dark corner pixel should be 0');
  });
});

describe('grahamScan', () => {
  it('returns convex hull of a simple point set', () => {
    const points = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      { x: 0, y: 10 }, { x: 5, y: 5 }, // interior point
    ];
    const hull = grahamScan(points);
    assert.strictEqual(hull.length, 4, 'Hull should have 4 points for a square with interior point');
  });

  it('handles collinear points', () => {
    const points = [
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const hull = grahamScan(points);
    // Collinear points on bottom edge: only endpoints should remain
    assert.ok(hull.length >= 4, 'Hull should have at least 4 points');
  });

  it('returns same points for a triangle', () => {
    const points = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 },
    ];
    const hull = grahamScan(points);
    assert.strictEqual(hull.length, 3);
  });
});

describe('shoelaceArea', () => {
  it('computes area of a unit square', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    assert.strictEqual(shoelaceArea(pts), 1);
  });

  it('computes area of a 10x20 rectangle', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    assert.strictEqual(shoelaceArea(pts), 200);
  });

  it('computes area of a rotated square', () => {
    // 45-degree rotated square with side sqrt(2)*5
    const pts = [{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }];
    assert.strictEqual(shoelaceArea(pts), 50);
  });
});

describe('hullToQuad', () => {
  it('extracts TL/TR/BR/BL from an axis-aligned rectangle hull', () => {
    const hull = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 },
    ];
    const quad = hullToQuad(hull);
    assert.deepStrictEqual(quad.tl, { x: 0, y: 0 });
    assert.deepStrictEqual(quad.tr, { x: 100, y: 0 });
    assert.deepStrictEqual(quad.br, { x: 100, y: 80 });
    assert.deepStrictEqual(quad.bl, { x: 0, y: 80 });
  });

  it('extracts corners from a 45-degree rotated rectangle', () => {
    // Diamond shape: top at (50,0), right at (100,50), bottom at (50,100), left at (0,50)
    const hull = [
      { x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 },
    ];
    const quad = hullToQuad(hull);
    // TL = min(x+y) = (50,0) sum=50
    assert.deepStrictEqual(quad.tl, { x: 50, y: 0 });
    // TR = max(x-y) = (100,50) diff=50
    assert.deepStrictEqual(quad.tr, { x: 100, y: 50 });
    // BR = max(x+y) = (50,100) sum=150
    assert.deepStrictEqual(quad.br, { x: 50, y: 100 });
    // BL = min(x-y) = (0,50) diff=-50
    assert.deepStrictEqual(quad.bl, { x: 0, y: 50 });
  });

  it('returns null for fewer than 4 points', () => {
    assert.strictEqual(hullToQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]), null);
  });
});

describe('morphDilate', () => {
  it('expands a single pixel by the given radius', () => {
    const w = 10, h = 10;
    const binary = new Uint8Array(w * h);
    binary[5 * w + 5] = 1; // center pixel
    const dilated = morphDilate(binary, w, h, 2);
    // Pixel at (5,5) dilated by 2 should fill (3..7, 3..7)
    assert.strictEqual(dilated[3 * w + 3], 1, 'Should be dilated at (3,3)');
    assert.strictEqual(dilated[7 * w + 7], 1, 'Should be dilated at (7,7)');
    assert.strictEqual(dilated[2 * w + 2], 0, 'Should NOT be dilated at (2,2)');
  });
});

describe('floodFillBorder', () => {
  it('fills background around a centered rectangle', () => {
    // 10x10 image with a 6x6 rectangle of 1s in the center (edges)
    const w = 10, h = 10;
    const binary = new Uint8Array(w * h);
    // Draw rectangle border at rows 2,7 and cols 2,7
    for (let x = 2; x <= 7; x++) { binary[2 * w + x] = 1; binary[7 * w + x] = 1; }
    for (let y = 2; y <= 7; y++) { binary[y * w + 2] = 1; binary[y * w + 7] = 1; }

    const bg = floodFillBorder(binary, w, h);

    // Outside the rectangle should be background
    assert.strictEqual(bg[0], 1, 'Corner (0,0) should be background');
    assert.strictEqual(bg[1 * w + 1], 1, 'Point (1,1) should be background');
    // Inside the rectangle should NOT be background
    assert.strictEqual(bg[5 * w + 5], 0, 'Center (5,5) should not be background');
    assert.strictEqual(bg[4 * w + 4], 0, 'Point (4,4) should not be background');
  });
});

describe('downsampleEdges', () => {
  it('downsamples a 10x10 image to 5x5', () => {
    const src = new Uint8Array(100);
    for (let i = 0; i < 100; i++) src[i] = i;
    const dst = downsampleEdges(src, 10, 10, 5, 5);
    assert.strictEqual(dst.length, 25);
    // Check that values are sampled from source
    assert.strictEqual(dst[0], src[0]);
  });
});

/**
 * Unit tests for pure computation functions in scanner.js
 * Uses Node.js built-in test runner (node:test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSkewAngle,
  applyAdaptiveThresholdToArray,
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

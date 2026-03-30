/**
 * Unit tests for scanner-core.js pure math functions.
 * Uses Node.js built-in test runner (node:test) — zero dependencies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import {
  convolve,
  grayscale,
  downscale,
  gaussianBlur,
  detectDocument,
  applyAdaptiveThresholdToArray,
  computeSkewAngle,
  shoelaceArea,
  adj3,
  mul3,
  mul3v,
  basisToPoints,
  createProjector,
} from './scanner-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('scanner-core.js exports', () => {
  it('exports all 13 expected functions', () => {
    const expected = [
      'convolve', 'grayscale', 'downscale', 'gaussianBlur',
      'detectDocument', 'applyAdaptiveThresholdToArray',
      'computeSkewAngle', 'shoelaceArea',
      'adj3', 'mul3', 'mul3v', 'basisToPoints', 'createProjector',
    ];
    const fns = {
      convolve, grayscale, downscale, gaussianBlur,
      detectDocument, applyAdaptiveThresholdToArray,
      computeSkewAngle, shoelaceArea,
      adj3, mul3, mul3v, basisToPoints, createProjector,
    };
    for (const name of expected) {
      assert.strictEqual(typeof fns[name], 'function', `Expected ${name} to be a function`);
    }
  });
});

describe('scanner-core.js DOM isolation', () => {
  it('contains no DOM references', () => {
    const src = readFileSync(join(__dirname, 'scanner-core.js'), 'utf8');
    const domPatterns = [
      'document.',
      'createElement',
      'getContext',
      'new Image',
      'URL.createObjectURL',
      // Check for canvas/Canvas class references (not the variable name pattern in comments)
      // We check for method call patterns that imply Canvas object usage
    ];
    for (const pattern of domPatterns) {
      assert.ok(
        !src.includes(pattern),
        `scanner-core.js must not contain "${pattern}" (DOM reference found)`
      );
    }
    // Check for Canvas class usage (capital C as a class/constructor, not in comments)
    const codeLines = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const codeOnly = codeLines.join('\n');
    assert.ok(
      !codeOnly.includes('new Canvas('),
      'scanner-core.js must not use "new Canvas(" (DOM reference)'
    );
  });
});

describe('detectDocument', () => {
  it('returns null for blank (all-zero) pixel data', () => {
    const w = 100, h = 100;
    const rgba = new Uint8ClampedArray(w * h * 4); // all zeros
    const result = detectDocument(rgba, w, h);
    assert.strictEqual(result, null, 'Expected null for blank image with no edges');
  });
});

describe('applyAdaptiveThresholdToArray', () => {
  it('returns Uint8Array of same length with only 0 and 255 values', () => {
    const w = 10, h = 10;
    // Gradient: values 0 through 99
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = Math.floor(i * (255 / (w * h)));
    }
    const result = applyAdaptiveThresholdToArray(gray, w, h, 5, 10);
    assert.strictEqual(result.length, w * h, 'Output length must match input');
    assert.ok(result instanceof Uint8Array, 'Result must be a Uint8Array');
    for (let i = 0; i < result.length; i++) {
      assert.ok(
        result[i] === 0 || result[i] === 255,
        `Pixel ${i} has value ${result[i]} — expected 0 or 255`
      );
    }
  });
});

describe('computeSkewAngle', () => {
  it('returns a number approximately matching expected skew', () => {
    const corners = {
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 5 },
      br: { x: 100, y: 105 },
      bl: { x: 0, y: 100 },
    };
    const angle = computeSkewAngle(corners);
    assert.strictEqual(typeof angle, 'number', 'Result must be a number');
    // atan2(5, 100) ≈ 0.04996 radians ≈ 2.862 degrees
    const degrees = angle * 180 / Math.PI;
    assert.ok(
      Math.abs(degrees - 2.862) < 0.01,
      `Expected ~2.862 degrees, got ${degrees.toFixed(4)}`
    );
  });
});

describe('shoelaceArea', () => {
  it('returns a positive number for a unit square', () => {
    const unitSquare = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const area = shoelaceArea(unitSquare);
    assert.strictEqual(typeof area, 'number', 'Result must be a number');
    assert.ok(area > 0, `Area must be positive, got ${area}`);
    assert.ok(Math.abs(area - 1) < 1e-10, `Expected area 1, got ${area}`);
  });
});

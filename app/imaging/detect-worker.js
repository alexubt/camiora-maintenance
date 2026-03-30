/**
 * Web Worker for background document edge detection.
 *
 * Receives raw pixel data via transferable ArrayBuffer,
 * runs detectDocument, and posts back corner coordinates.
 *
 * Message protocol:
 *   Main → Worker: { rgba: ArrayBuffer (transferable), width: number, height: number }
 *   Worker → Main: { corners: {tl, tr, br, bl} | null }
 */

import { detectDocument } from './scanner-core.js';

self.onmessage = function({ data: { rgba, width, height } }) {
  const pixels = new Uint8ClampedArray(rgba);
  const corners = detectDocument(pixels, width, height);
  self.postMessage({ corners });
};

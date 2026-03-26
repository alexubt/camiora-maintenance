/**
 * Invoice extraction client — sends image or PDF to the Cloudflare Worker
 * which calls Claude Haiku 4.5 Vision API for structured data extraction.
 *
 * Native ES module. Browser-compatible (uses FileReader, createImageBitmap, canvas).
 * Node.js note: blobToBase64 and resizeImageBlob are browser-only; their logic
 * is tested via structural and mock patterns in extract.test.js.
 */

const WORKER_URL = 'https://camiora-api-proxy.camiora.workers.dev';

/**
 * Extract invoice fields from an image or PDF blob by sending it to the
 * Cloudflare Worker, which calls Claude Haiku Vision API.
 *
 * @param {Blob|File} blob - Image (JPEG/PNG) or PDF blob
 * @param {string} mimeType - "image/jpeg" | "image/png" | "application/pdf"
 * @param {string[]} fleet - Array of unit IDs from the fleet roster
 * @returns {Promise<{
 *   unit_number: string|null,
 *   date: string|null,
 *   vendor: string|null,
 *   vendor_address: string|null,
 *   invoice_number: string|null,
 *   total_cost: number|null,
 *   labor_cost: number|null,
 *   parts_cost: number|null,
 *   summary: string,
 *   line_items: Array<{description: string, amount: number}>,
 *   detected_milestones: string[],
 *   confidence: number
 * }>}
 */
export async function extractInvoice(blob, mimeType, fleet) {
  // Resize images before encoding to reduce token cost (~fewer pixels).
  // createImageBitmap is browser-only; skip in non-browser environments (e.g. tests).
  let processedBlob = blob;
  if ((mimeType === 'image/jpeg' || mimeType === 'image/png') &&
      typeof createImageBitmap === 'function') {
    processedBlob = await resizeImageBlob(blob);
  }

  const base64 = await blobToBase64(processedBlob);

  const response = await fetch(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, mimeType, fleet }),
  });

  if (!response.ok) {
    let errBody = {};
    try { errBody = await response.json(); } catch (_) { /* ignore parse error */ }
    throw new Error(errBody.error || String(response.status));
  }

  return response.json();
}

/**
 * Convert a Blob or File to raw base64 (strips the data-URL prefix).
 * Uses FileReader.readAsDataURL (browser-only).
 *
 * @param {Blob} blob
 * @returns {Promise<string>} Raw base64 string (no "data:...;base64," prefix)
 */
export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // readAsDataURL returns "data:<mimeType>;base64,<base64data>"
      // We split on the first comma to get only the raw base64
      const result = reader.result;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Resize an image Blob to at most maxPx on the longest dimension.
 * Returns a new JPEG Blob at 0.85 quality.
 * Uses createImageBitmap + HTMLCanvasElement (browser-only).
 * GPU memory released by closing the ImageBitmap and zeroing the canvas.
 *
 * @param {Blob} blob - Image blob
 * @param {number} [maxPx=1500] - Maximum dimension in pixels
 * @returns {Promise<Blob>} Resized JPEG blob
 */
export async function resizeImageBlob(blob, maxPx = 1500) {
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;

  let targetW = width;
  let targetH = height;

  if (width > maxPx || height > maxPx) {
    const scale = maxPx / Math.max(width, height);
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  canvas.getContext('2d').drawImage(bmp, 0, 0, targetW, targetH);

  bmp.close();  // release GPU-side ImageBitmap memory

  const resizedBlob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  );

  // Release canvas GPU memory
  canvas.width = 0;
  canvas.height = 0;

  return resizedBlob;
}

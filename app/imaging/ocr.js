/**
 * OCR module — lazy-loads Tesseract.js v5 and parses invoice fields.
 * Native ES module. Tesseract.js is loaded on first scan, not on page load.
 */

let _worker = null;

async function ensureTesseract() {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function runOCR(imageBlob) {
  await ensureTesseract();
  if (!_worker) {
    _worker = await Tesseract.createWorker('eng');
  }
  const { data: { text } } = await _worker.recognize(imageBlob);
  return parseInvoiceFields(text);
}

/**
 * Parse invoice text and extract unit number, date, and service type.
 * Returns both parsed values and raw detected strings for UI validation.
 * @param {string} text - Raw OCR text
 * @returns {{ unitNumber: string|null, unitRaw: string|null, date: string|null, serviceType: string|null, rawText: string }}
 */
export function parseInvoiceFields(text) {
  // Try multiple unit number patterns in order of specificity
  const unitPatterns = [
    /\b((?:TR|TRK|TL|TRL)[-\s]?\d{1,4})\b/i,         // TR-042, TRK 7, TL-123
    /\bUnit\s*#?\s*(\d{1,5})\b/i,                       // Unit #1234, Unit 042
    /\b(?:truck|trailer|reefer)\s*#?\s*(\d{1,5})\b/i,   // Truck #042, Trailer 123
    /\b#\s*(\d{3,5})\b/,                                 // #042, #1234
  ];

  let unitRaw = null;
  let unitNumber = null;
  for (const pattern of unitPatterns) {
    const m = text.match(pattern);
    if (m) {
      unitRaw = m[0].trim();
      // Extract just the digits
      const digits = m[1] ? m[1].replace(/\D/g, '') : m[0].replace(/\D/g, '');
      unitNumber = digits.padStart(3, '0');
      break;
    }
  }

  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/);

  const svcMap = {
    'oil': 'oil-change',
    'tire': 'tire-rotation',
    'brake': 'brake-inspection',
    'dot': 'dot-inspection',
    'pm service': 'pm-service',
    'engine': 'engine-repair',
    'transmission': 'transmission',
    'electrical': 'electrical',
    'a/c': 'ac-service',
  };

  let serviceType = null;
  const lower = text.toLowerCase();
  for (const [kw, val] of Object.entries(svcMap)) {
    if (lower.includes(kw)) { serviceType = val; break; }
  }

  return {
    unitNumber: unitNumber,
    unitRaw: unitRaw,
    date: dateMatch ? dateMatch[1] : null,
    serviceType,
    rawText: text,
  };
}

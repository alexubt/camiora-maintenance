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
 * @param {string} text - Raw OCR text
 * @returns {{ unitNumber: string|null, date: string|null, serviceType: string|null }}
 */
export function parseInvoiceFields(text) {
  const unitMatch = text.match(/\b(?:TR|TRK|TL|TRL)[-\s]?(\d{1,4})\b/i);
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
    unitNumber: unitMatch ? unitMatch[1].padStart(3, '0') : null,
    date: dateMatch ? dateMatch[1] : null,
    serviceType,
  };
}

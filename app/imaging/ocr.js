/**
 * OCR module — PaddleOCR v5 with position-aware invoice field extraction.
 *
 * Uses paddleocr.js (ONNX Runtime) for text detection + recognition with
 * bounding boxes. Then applies spatial scoring rules to extract invoice
 * fields by position and context rather than pure regex on flat text.
 *
 * Falls back to Tesseract.js if PaddleOCR fails to load.
 *
 * Native ES module. Lazy-loads on first scan.
 */

import { state } from '../state.js';

// ── PaddleOCR lazy loading ──────────────────────────────────────────────────

let _paddleService = null;
let _paddleLoadFailed = false;
let _tesseractWorker = null;

const MODEL_BASE = 'https://cdn.jsdelivr.net/npm/paddleocr@1/assets';
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/ort.min.mjs';

async function loadScript(src) {
  if (src.endsWith('.mjs')) {
    // ES module import
    return await import(/* webpackIgnore: true */ src);
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function fetchArrayBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.arrayBuffer();
}

async function ensurePaddleOCR() {
  if (_paddleService) return _paddleService;
  if (_paddleLoadFailed) return null;

  try {
    // Load ONNX Runtime as ES module
    const ort = await import(/* webpackIgnore: true */ ORT_CDN);

    // Load PaddleOCR library
    const { PaddleOcrService } = await import(
      /* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/paddleocr@1/dist/index.mjs'
    );

    // Load models and dictionary in parallel
    const [detModel, recModel, dictText] = await Promise.all([
      fetchArrayBuffer(`${MODEL_BASE}/PP-OCRv5_mobile_det_infer.onnx`),
      fetchArrayBuffer(`${MODEL_BASE}/PP-OCRv5_mobile_rec_infer.onnx`),
      fetch(`${MODEL_BASE}/ppocrv5_dict.txt`).then(r => r.text()),
    ]);

    const dict = dictText.split('\n').filter(Boolean);

    _paddleService = await PaddleOcrService.createInstance({
      ort,
      detection: {
        modelBuffer: detModel,
        maxSideLength: 960,
        minimumAreaThreshold: 20,
        textPixelThreshold: 0.55,
        paddingBoxVertical: 0.3,
        paddingBoxHorizontal: 0.5,
      },
      recognition: {
        modelBuffer: recModel,
        charactersDictionary: dict,
        imageHeight: 48,
      },
    });

    return _paddleService;
  } catch (err) {
    console.warn('PaddleOCR load failed, will fall back to Tesseract:', err.message);
    _paddleLoadFailed = true;
    return null;
  }
}

// ── Tesseract fallback ──────────────────────────────────────────────────────

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

async function runTesseractFallback(imageBlob) {
  await ensureTesseract();
  if (!_tesseractWorker) {
    _tesseractWorker = await Tesseract.createWorker('eng');
  }
  const { data: { text } } = await _tesseractWorker.recognize(imageBlob);
  return parseInvoiceFieldsFromText(text);
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Run OCR on an image blob. Returns extracted invoice fields.
 * Tries PaddleOCR (position-aware), falls back to Tesseract (text-only).
 *
 * @param {Blob} imageBlob
 * @returns {Promise<{unitNumber: string|null, unitRaw: string|null, date: string|null, serviceType: string|null, rawText: string}>}
 */
export async function runOCR(imageBlob) {
  const paddle = await ensurePaddleOCR();

  if (paddle) {
    try {
      return await runPaddleOCR(paddle, imageBlob);
    } catch (err) {
      console.warn('PaddleOCR recognize failed, falling back to Tesseract:', err.message);
    }
  }

  return runTesseractFallback(imageBlob);
}

// ── PaddleOCR recognition ───────────────────────────────────────────────────

async function runPaddleOCR(service, imageBlob) {
  // Convert blob to ImageData-like input
  const bmp = await createImageBitmap(imageBlob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0; // release

  // Run PaddleOCR — get regions with bounding boxes
  const results = await service.recognize({
    width: imageData.width,
    height: imageData.height,
    data: new Uint8Array(imageData.data.buffer),
  }, {
    ordering: { sortByReadingOrder: true },
  });

  // Map to our internal region format
  const imgW = imageData.width;
  const imgH = imageData.height;
  const regions = (results || []).map(r => ({
    text: r.text || '',
    confidence: r.confidence || 0,
    // Normalize box to 0-1 range relative to image dimensions
    nx: (r.box?.x || 0) / imgW,
    ny: (r.box?.y || 0) / imgH,
    nw: (r.box?.width || 0) / imgW,
    nh: (r.box?.height || 0) / imgH,
    // Raw box for debugging
    box: r.box,
  }));

  // Build raw text from all regions (for fallback/logging)
  const rawText = regions.map(r => r.text).join('\n');

  // Apply spatial scoring
  const fleetUnits = state.fleet?.units || [];
  const unitResult = scoreUnitNumber(regions, fleetUnits, imgH);
  const dateResult = scoreDate(regions);
  const serviceResult = scoreServiceType(regions);

  return {
    unitNumber: unitResult.unitNumber,
    unitRaw: unitResult.unitRaw,
    date: dateResult,
    serviceType: serviceResult,
    rawText,
  };
}

// ── Spatial scoring: Unit Number ────────────────────────────────────────────

/**
 * Score each text region as a potential unit number.
 * Matches against the fleet roster — no hardcoded prefix patterns.
 */
function scoreUnitNumber(regions, fleetUnits, imgH) {
  if (!fleetUnits.length) return { unitNumber: null, unitRaw: null };

  const unitIds = fleetUnits.map(u => u.UnitId?.toUpperCase()).filter(Boolean);

  let bestScore = 0;
  let bestUnit = null;
  let bestRaw = null;

  for (const region of regions) {
    const text = region.text.trim().toUpperCase();
    if (!text || text.length < 2) continue;

    for (const uid of unitIds) {
      let matchScore = 0;

      // Exact match
      if (text === uid) {
        matchScore = 100;
      }
      // Text contains the unit ID
      else if (text.includes(uid)) {
        matchScore = 80;
      }
      // Unit ID contains the text (partial OCR read)
      else if (uid.includes(text) && text.length >= 3) {
        matchScore = 50;
      }
      // Fuzzy match — edit distance ≤ 2
      else {
        const dist = editDistance(text, uid);
        if (dist <= 1) matchScore = 70;
        else if (dist <= 2 && text.length >= 4) matchScore = 40;
      }

      if (matchScore === 0) continue;

      // Spatial boosts/penalties
      // Boost: top 40% of page (handwritten numbers placed at top)
      if (region.ny < 0.4) matchScore += 15;
      // Boost: large text (handwritten = bigger)
      if (region.nh > 0.03) matchScore += 10;
      // Penalize: in address context (near street keywords)
      const lower = region.text.toLowerCase();
      if (/\b(st|ave|blvd|suite|rd|dr|hwy|po box)\b/i.test(lower)) matchScore -= 30;
      // Penalize: very bottom of page (footer)
      if (region.ny > 0.85) matchScore -= 20;

      if (matchScore > bestScore) {
        bestScore = matchScore;
        bestUnit = uid;
        bestRaw = region.text.trim();
      }
    }
  }

  if (!bestUnit) return { unitNumber: null, unitRaw: null };

  // Find the original-case unit ID
  const originalUnit = fleetUnits.find(u => u.UnitId?.toUpperCase() === bestUnit);
  return {
    unitNumber: originalUnit?.UnitId || bestUnit,
    unitRaw: bestRaw,
  };
}

// ── Spatial scoring: Date ───────────────────────────────────────────────────

const DATE_PATTERNS = [
  /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,          // MM/DD/YYYY or M/D/YYYY
  /\b(\d{1,2}-\d{1,2}-\d{4})\b/,             // MM-DD-YYYY
  /\b(\d{4}-\d{2}-\d{2})\b/,                  // YYYY-MM-DD (ISO)
  /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/,           // MM.DD.YYYY
  /\b([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})\b/, // March 19, 2026
];

/**
 * Score each text region as a potential invoice date.
 * Boosts dates near "Date"/"Invoice" labels, penalizes near "Exp"/"DOT"/"License".
 */
function scoreDate(regions) {
  const candidates = [];

  for (const region of regions) {
    const text = region.text.trim();
    for (const pattern of DATE_PATTERNS) {
      const m = text.match(pattern);
      if (!m) continue;

      let score = 50; // base score for any date match

      // Check nearby regions for context labels
      for (const other of regions) {
        if (other === region) continue;
        const dist = Math.abs(other.ny - region.ny); // vertical distance
        if (dist > 0.08) continue; // only look at nearby regions (~same line)

        const otherLow = other.text.toLowerCase();
        // Boost: near "date", "invoice", "inv"
        if (/\b(date|invoice|inv\b|billed|issued)\b/i.test(otherLow)) score += 30;
        // Penalize: near "exp", "dot", "license", "valid"
        if (/\b(exp|expir|dot|license|valid|renew)\b/i.test(otherLow)) score -= 40;
      }

      // Spatial boost: top 60% of page (invoice dates are in header)
      if (region.ny < 0.6) score += 10;
      // Penalize: very bottom (footer dates)
      if (region.ny > 0.85) score -= 15;

      candidates.push({ date: m[1], score });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].date;
}

// ── Spatial scoring: Service Type ───────────────────────────────────────────

const SERVICE_MAP = {
  'oil change': 'oil-change',
  'oil': 'oil-change',
  'tire': 'tire-rotation',
  'brake': 'brake-inspection',
  'dot inspection': 'dot-inspection',
  'dot': 'dot-inspection',
  'pm service': 'pm-service',
  'preventive': 'pm-service',
  'engine': 'engine-repair',
  'transmission': 'transmission',
  'electrical': 'electrical',
  'a/c': 'ac-service',
  'air conditioning': 'ac-service',
  'alignment': 'alignment',
  'suspension': 'suspension',
  'dpf': 'dpf-cleaning',
};

/**
 * Score each text region as a potential service type.
 * Boosts matches in the middle of the page (line items area).
 */
function scoreServiceType(regions) {
  const candidates = [];

  for (const region of regions) {
    const lower = region.text.toLowerCase();

    for (const [keyword, value] of Object.entries(SERVICE_MAP)) {
      if (!lower.includes(keyword)) continue;

      let score = 50;

      // Boost: middle of page (line items area, 20%-80%)
      if (region.ny > 0.2 && region.ny < 0.8) score += 20;
      // Penalize: very top (vendor name area)
      if (region.ny < 0.1) score -= 20;
      // Boost: longer keyword matches are more specific
      if (keyword.length > 5) score += 10;
      // Boost: higher OCR confidence
      score += region.confidence * 10;

      candidates.push({ serviceType: value, score });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].serviceType;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Levenshtein edit distance — for fuzzy unit ID matching.
 * Handles OCR misreads: 0↔O, 1↔l↔I, etc.
 */
function editDistance(a, b) {
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      let cost = a[i - 1] === b[j - 1] ? 0 : 1;
      // Reduce cost for common OCR confusions
      if (cost === 1) {
        const ca = a[i - 1], cb = b[j - 1];
        if (isOcrConfusable(ca, cb)) cost = 0.5;
      }
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

function isOcrConfusable(a, b) {
  const confusions = [
    ['0', 'O', 'o', 'Q'],
    ['1', 'l', 'I', 'i', '|'],
    ['5', 'S', 's'],
    ['8', 'B'],
    ['2', 'Z', 'z'],
    ['6', 'G'],
  ];
  for (const group of confusions) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}

// ── Text-only fallback parser (used by Tesseract path) ──────────────────────

/**
 * Parse invoice fields from flat text (no bounding boxes).
 * Used as Tesseract fallback — same as original parseInvoiceFields.
 */
export function parseInvoiceFields(text) {
  return parseInvoiceFieldsFromText(text);
}

function parseInvoiceFieldsFromText(text) {
  // Match against fleet unit IDs first
  const fleetUnits = state.fleet?.units || [];
  let unitNumber = null;
  let unitRaw = null;

  if (fleetUnits.length) {
    const upper = text.toUpperCase();
    let bestLen = 0;
    for (const u of fleetUnits) {
      const uid = u.UnitId?.toUpperCase();
      if (uid && upper.includes(uid) && uid.length > bestLen) {
        unitNumber = u.UnitId;
        unitRaw = u.UnitId;
        bestLen = uid.length;
      }
    }
  }

  // Fallback to regex patterns if no fleet match
  if (!unitNumber) {
    const unitPatterns = [
      /\b((?:TR|TRK|TL|TRL)[-\s]?\d{1,4})\b/i,
      /\bUnit\s*#?\s*(\d{1,5})\b/i,
      /\b(?:truck|trailer|reefer)\s*#?\s*(\d{1,5})\b/i,
      /\b#\s*(\d{3,5})\b/,
    ];
    for (const pattern of unitPatterns) {
      const m = text.match(pattern);
      if (m) {
        unitRaw = m[0].trim();
        const digits = m[1] ? m[1].replace(/\D/g, '') : m[0].replace(/\D/g, '');
        unitNumber = digits.padStart(3, '0');
        break;
      }
    }
  }

  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/);

  const svcMap = {
    'oil': 'oil-change', 'tire': 'tire-rotation', 'brake': 'brake-inspection',
    'dot': 'dot-inspection', 'pm service': 'pm-service', 'engine': 'engine-repair',
    'transmission': 'transmission', 'electrical': 'electrical', 'a/c': 'ac-service',
  };

  let serviceType = null;
  const lower = text.toLowerCase();
  for (const [kw, val] of Object.entries(svcMap)) {
    if (lower.includes(kw)) { serviceType = val; break; }
  }

  return {
    unitNumber,
    unitRaw,
    date: dateMatch ? dateMatch[1] : null,
    serviceType,
    rawText: text,
  };
}

/**
 * OCR module — Tesseract.js v5 with position-aware invoice field extraction.
 *
 * Uses Tesseract's word-level bounding boxes (data.words[].bbox) to apply
 * spatial scoring rules — extracting invoice fields by position and context
 * rather than pure regex on flat text.
 *
 * Native ES module. Lazy-loads on first scan.
 */

import { state } from '../state.js';

// ── Tesseract lazy loading ──────────────────────────────────────────────────

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

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Run OCR on an image blob. Returns extracted invoice fields.
 * Uses Tesseract word-level bounding boxes for spatial scoring.
 *
 * @param {Blob} imageBlob
 * @returns {Promise<{unitNumber: string|null, unitRaw: string|null, date: string|null, serviceType: string|null, rawText: string}>}
 */
export async function runOCR(imageBlob) {
  await ensureTesseract();
  if (!_worker) {
    _worker = await Tesseract.createWorker('eng');
  }

  const { data } = await _worker.recognize(imageBlob);

  // Get image dimensions from the first block or page
  const imgW = data.blocks?.[0]?.bbox?.x1 || data.words?.[0]?.bbox?.x1 || 1;
  const imgH = data.blocks?.[0]?.bbox?.y1 || data.words?.[0]?.bbox?.y1 || 1;

  // Find actual image bounds from all words
  let maxX = 0, maxY = 0;
  for (const w of (data.words || [])) {
    if (w.bbox.x1 > maxX) maxX = w.bbox.x1;
    if (w.bbox.y1 > maxY) maxY = w.bbox.y1;
  }
  const width = maxX || imgW;
  const height = maxY || imgH;

  // Build regions from Tesseract lines (group words into lines for context)
  const regions = [];
  for (const line of (data.lines || [])) {
    const text = line.text?.trim();
    if (!text) continue;
    regions.push({
      text,
      confidence: (line.confidence || 0) / 100,
      // Normalize to 0-1 range
      nx: line.bbox.x0 / width,
      ny: line.bbox.y0 / height,
      nw: (line.bbox.x1 - line.bbox.x0) / width,
      nh: (line.bbox.y1 - line.bbox.y0) / height,
    });
  }

  // Also build word-level regions for fine-grained unit matching
  const wordRegions = [];
  for (const word of (data.words || [])) {
    const text = word.text?.trim();
    if (!text || text.length < 2) continue;
    wordRegions.push({
      text,
      confidence: (word.confidence || 0) / 100,
      nx: word.bbox.x0 / width,
      ny: word.bbox.y0 / height,
      nw: (word.bbox.x1 - word.bbox.x0) / width,
      nh: (word.bbox.y1 - word.bbox.y0) / height,
    });
  }

  const rawText = data.text || '';
  const fleetUnits = state.fleet?.units || [];

  const unitResult = scoreUnitNumber(wordRegions, regions, fleetUnits);
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
 * Matches against the fleet roster first, falls back to regex patterns.
 */
function scoreUnitNumber(wordRegions, lineRegions, fleetUnits) {
  // Strategy 1: Match against fleet unit IDs
  if (fleetUnits.length) {
    const unitIds = fleetUnits.map(u => u.UnitId).filter(Boolean);

    let bestScore = 0;
    let bestUnit = null;
    let bestRaw = null;

    // Check word-level regions (more precise for unit IDs)
    for (const region of wordRegions) {
      const text = region.text.trim().toUpperCase();
      if (!text) continue;

      for (const uid of unitIds) {
        const uidUp = uid.toUpperCase();
        let matchScore = 0;

        if (text === uidUp) matchScore = 100;
        else if (text.includes(uidUp)) matchScore = 80;
        else if (uidUp.includes(text) && text.length >= 3) matchScore = 50;
        else {
          const dist = editDistance(text, uidUp);
          if (dist <= 1) matchScore = 70;
          else if (dist <= 2 && text.length >= 4) matchScore = 40;
        }

        if (matchScore === 0) continue;

        // Spatial boosts
        if (region.ny < 0.4) matchScore += 15;  // top of page
        if (region.nh > 0.03) matchScore += 10;  // large text (handwritten)
        if (region.ny > 0.85) matchScore -= 20;  // footer

        // Check line context for address words
        const lineText = findContainingLine(lineRegions, region)?.text?.toLowerCase() || '';
        if (/\b(st|ave|blvd|suite|rd|dr|hwy|po box|street|avenue)\b/.test(lineText)) matchScore -= 30;

        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestUnit = uid;
          bestRaw = region.text.trim();
        }
      }
    }

    if (bestUnit) {
      return { unitNumber: bestUnit, unitRaw: bestRaw };
    }
  }

  // Strategy 2: Regex fallback (no fleet match)
  const patterns = [
    /\b((?:TR|TRK|TL|TRL)[-\s]?\d{1,4})\b/i,
    /\bUnit\s*#?\s*(\d{1,5})\b/i,
    /\b(?:truck|trailer|reefer)\s*#?\s*(\d{1,5})\b/i,
  ];

  let bestScore = 0;
  let bestMatch = null;

  for (const region of lineRegions) {
    for (const pattern of patterns) {
      const m = region.text.match(pattern);
      if (!m) continue;

      let score = 50;
      if (region.ny < 0.4) score += 15;
      if (region.nh > 0.03) score += 10;
      if (/\b(st|ave|blvd|suite|rd|dr|hwy)\b/i.test(region.text)) score -= 30;
      if (region.ny > 0.85) score -= 20;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = m;
      }
    }
  }

  if (bestMatch) {
    const raw = bestMatch[0].trim();
    const digits = bestMatch[1] ? bestMatch[1].replace(/\D/g, '') : raw.replace(/\D/g, '');
    return { unitNumber: digits.padStart(3, '0'), unitRaw: raw };
  }

  return { unitNumber: null, unitRaw: null };
}

/**
 * Find the line region that contains a word region (by vertical overlap).
 */
function findContainingLine(lineRegions, wordRegion) {
  for (const line of lineRegions) {
    if (wordRegion.ny >= line.ny - 0.01 &&
        wordRegion.ny <= line.ny + line.nh + 0.01) {
      return line;
    }
  }
  return null;
}

// ── Spatial scoring: Date ───────────────────────────────────────────────────

const DATE_PATTERNS = [
  /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
  /\b(\d{1,2}-\d{1,2}-\d{4})\b/,
  /\b(\d{4}-\d{2}-\d{2})\b/,
  /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/,
];

function scoreDate(regions) {
  const candidates = [];

  for (const region of regions) {
    const text = region.text.trim();
    for (const pattern of DATE_PATTERNS) {
      const m = text.match(pattern);
      if (!m) continue;

      let score = 50;

      // Check same line and nearby lines for context
      for (const other of regions) {
        const dist = Math.abs(other.ny - region.ny);
        if (dist > 0.08) continue;
        const otherLow = other.text.toLowerCase();
        if (/\b(date|invoice|inv\b|billed|issued)\b/.test(otherLow)) score += 30;
        if (/\b(exp|expir|dot|license|valid|renew)\b/.test(otherLow)) score -= 40;
      }

      // Also check within the same line text
      const lineLow = text.toLowerCase();
      if (/\b(date|invoice)\b/.test(lineLow)) score += 25;
      if (/\b(exp|expir|dot|license)\b/.test(lineLow)) score -= 35;

      if (region.ny < 0.6) score += 10;
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

function scoreServiceType(regions) {
  const candidates = [];

  for (const region of regions) {
    const lower = region.text.toLowerCase();
    for (const [keyword, value] of Object.entries(SERVICE_MAP)) {
      if (!lower.includes(keyword)) continue;

      let score = 50;
      if (region.ny > 0.2 && region.ny < 0.8) score += 20;
      if (region.ny < 0.1) score -= 20;
      if (keyword.length > 5) score += 10;
      score += region.confidence * 10;

      candidates.push({ serviceType: value, score });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].serviceType;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function editDistance(a, b) {
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      let cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (cost === 1 && isOcrConfusable(a[i - 1], b[j - 1])) cost = 0.5;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

function isOcrConfusable(a, b) {
  const groups = [
    ['0', 'O', 'o', 'Q'], ['1', 'l', 'I', 'i', '|'],
    ['5', 'S', 's'], ['8', 'B'], ['2', 'Z', 'z'], ['6', 'G'],
  ];
  for (const g of groups) {
    if (g.includes(a) && g.includes(b)) return true;
  }
  return false;
}

// ── Text-only parser (exported for tests + backward compat) ─────────────────

export function parseInvoiceFields(text) {
  const fleetUnits = state.fleet?.units || [];
  let unitNumber = null, unitRaw = null;

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

  if (!unitNumber) {
    const patterns = [
      /\b((?:TR|TRK|TL|TRL)[-\s]?\d{1,4})\b/i,
      /\bUnit\s*#?\s*(\d{1,5})\b/i,
      /\b(?:truck|trailer|reefer)\s*#?\s*(\d{1,5})\b/i,
      /\b#\s*(\d{3,5})\b/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
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

  return { unitNumber, unitRaw, date: dateMatch ? dateMatch[1] : null, serviceType, rawText: text };
}

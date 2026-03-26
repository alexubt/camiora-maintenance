# Phase 8: Claude Vision Invoice Extraction - Research

**Researched:** 2026-03-26
**Domain:** Anthropic Vision API, Cloudflare Workers, Browser canvas/base64, Vanilla JS UI patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Drop Tesseract.js entirely — Claude Haiku 4.5 replaces it
- One API call per invoice, no retries unless network failure
- Claude reads both images (JPEG base64) and PDFs (PDF base64) natively
- Rename `worker/samsara-proxy.js` → `worker/api-proxy.js`
- Add `/extract-invoice` POST route alongside existing `/vehicles/stats` GET route
- Anthropic API key stored as Worker secret (ANTHROPIC_API_KEY)
- Origin-locked to GitHub Pages domain (same CORS pattern as Samsara proxy)
- Update `worker/wrangler.toml` with new name
- Camera scan: JPEG → Claude Worker + jsPDF → PDF → OneDrive
- PDF upload: PDF → Claude Worker directly + same PDF → OneDrive
- No pdf.js rendering for uploaded PDFs — Claude reads natively
- Multi-page scans: all pages assembled into PDF via jsPDF first, then PDF sent to Claude
- Full fleet roster sent in Claude prompt as compact comma-separated list
- Claude matches unit numbers (including handwritten) directly against roster
- Only complete, confident matches — no partial number guessing
- Tag picker UI pre-selects AI-detected milestones; user confirms/adjusts
- Tags derived from `getMilestonesForCategory(unitType)` for selected unit's category
- Horizontal scrollable chip/pill row below form fields
- On upload: `markDone()` called for each selected tag with invoice date + current Samsara mileage
- Images resized to max 1500px before base64 encoding
- Fleet roster as compact comma-separated list, not full unit objects
- One API call per invoice — no multi-step chains
- Worker route contract: see CONTEXT.md for exact request/response JSON schema
- Files to remove: `app/imaging/ocr.js`, `app/imaging/ocr.test.js`, pdf.js lazy-load, Tesseract CDN, spatial scoring, `#ocrResults`/`#ocrRawDetails` panels
- Files to modify: `upload.js`, `samsara-proxy.js` (→ `api-proxy.js`), `wrangler.toml`, `sw.js`, `app/samsara/sync.js`
- Files to create: `app/invoice/extract.js`

### Claude's Discretion
- Error handling and retry strategy for Worker API failures
- Loading/spinner UI during extraction (typically 3-5 seconds)
- How to handle extraction failures gracefully (fallback to manual entry)
- Confidence display (show score or just highlight low-confidence fields)
- Line items display format (table vs list)

### Deferred Ideas (OUT OF SCOPE)
- None — this phase must be complete and bulletproof. All extraction, matching, summarization, line items, milestone detection, milestone reset, and multi-format support ships in this phase.
</user_constraints>

---

## Summary

This phase replaces Tesseract.js OCR with a single Claude Haiku 4.5 API call via a Cloudflare Worker. The Worker receives a base64-encoded JPEG or PDF from the browser, attaches a structured extraction prompt with the fleet roster, forwards the request to the Anthropic Messages API, and returns a clean JSON payload. The browser then auto-fills the upload form fields, renders a milestone tag picker pre-populated with AI-detected maintenance types, and on final upload calls a batch milestone-reset function to update maintenance.csv.

The Anthropic API accepts images via `type: "image"` content blocks (JPEG/PNG/GIF/WebP, max 5 MB raw) and PDFs via `type: "document"` content blocks with `media_type: "application/pdf"`. Both use `source.type: "base64"` with raw base64 (no data-URL prefix). The correct model ID for Claude Haiku 4.5 is `claude-haiku-4-5-20251001` (alias: `claude-haiku-4-5`). Cloudflare Workers accept inbound POST bodies up to 100 MB on Free/Pro plans — well above the ~7 MB base64-encoded ceiling for a typical invoice. CPU time is 30 seconds by default (extendable to 5 minutes), sufficient for the 3-5 second Claude round-trip.

The current upload.js architecture is well-understood: `runOCR()` is called non-blockingly after scan and after file selection, with `prefillFormFields()` consuming its output. The new `extractInvoice()` function follows the same pattern and populates the same form fields plus new ones (vendor, cost, invoice number, summary, line items, milestone tags). The `markDone()` function in unit-detail.js operates on a single MaintId per call — batching multiple milestone resets requires sequential calls using a single downloaded maintenance.csv copy with multiple row mutations before one write (see Architecture Patterns).

**Primary recommendation:** Build the Worker route first (verifiable in isolation), then replace the upload.js OCR callsite with `extractInvoice()`, then add the milestone tag picker UI, then wire the batch milestone reset on submit.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Anthropic Messages API | REST (2023-06-01 version header) | Claude Haiku 4.5 vision extraction | Only supported path for direct API — no SDK in Cloudflare Worker |
| Cloudflare Workers | Runtime (no version) | Proxy API key, CORS, routing | Already deployed; add POST route |
| jsPDF | 4.2.0 (already in project) | Multi-page PDF assembly from scan blobs | Already used in `buildPdfFromPages()` |
| Browser Canvas API | Native | Image resizing to max 1500px | Already used in scanner.js and upload.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FileReader API | Native Browser | Blob → base64 data URL conversion | For uploaded PDF files not already base64 |
| createImageBitmap + Canvas | Native Browser | Resize images before encoding | Before sending JPEG scan pages |
| node:test | Built-in Node.js | Unit tests for extract.js | Zero-dependency, matches existing project pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| claude-haiku-4-5 | claude-sonnet-4-6 | Sonnet is 3x the cost; Haiku sufficient for extraction |
| base64 in request body | Anthropic Files API | Files API avoids re-sending on multi-turn; single-call pattern makes it unnecessary here |
| Sequential milestone resets (one CSV write per tag) | Batch mutation (single write) | Single write avoids CSV conflicts and is far faster with 3+ tags |

**Installation:** No new npm packages required. Anthropic API is called via raw `fetch()` in the Worker. All browser APIs are native.

---

## Architecture Patterns

### Recommended Project Structure
```
app/
├── invoice/
│   ├── extract.js       # NEW: thin client — fetch Worker, parse response
│   ├── naming.js        # unchanged
│   └── record.js        # unchanged — will add vendor/invoice fields later
│
├── imaging/
│   ├── scanner.js       # unchanged
│   └── ocr.js           # DELETE entirely
│
└── views/
    └── upload.js        # MODIFY: replace runOCR calls, add tag picker, milestone reset

worker/
├── api-proxy.js         # RENAMED from samsara-proxy.js — add /extract-invoice route
└── wrangler.toml        # update name = "camiora-api-proxy", main = "api-proxy.js"
```

### Pattern 1: Anthropic Messages API — Image Content Block

For JPEG images (camera scans), the Worker sends:

```javascript
// Source: https://platform.claude.com/docs/en/build-with-claude/vision
{
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  messages: [{
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",   // or "image/png"
          data: "<base64-string>"     // raw base64, NO "data:image/jpeg;base64," prefix
        }
      },
      {
        type: "text",
        text: "<extraction prompt>"
      }
    ]
  }]
}
```

**Key constraint:** Max 5 MB raw image per API call. After browser resizing to 1500px max-edge, a typical JPEG invoice sits at 100-400 KB — well within limit. (HIGH confidence — official docs)

### Pattern 2: Anthropic Messages API — PDF Document Content Block

For PDFs (assembled scan PDF or uploaded PDF), the Worker sends:

```javascript
// Source: https://platform.claude.com/docs/en/docs/build-with-claude/pdf-support
{
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  messages: [{
    role: "user",
    content: [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: "<base64-string>"     // raw base64, NO data-URL prefix
        }
      },
      {
        type: "text",
        text: "<extraction prompt>"
      }
    ]
  }]
}
```

**Key constraint:** Max 32 MB total request payload (including base64 overhead ~33%). A 5 MB raw PDF becomes ~6.7 MB base64 + JSON wrapper — still under 32 MB. (HIGH confidence — official docs)

**Multi-page support:** Claude processes all pages of a PDF; no per-page limit for Haiku 4.5 (200k context window, up to 100 images/pages). (HIGH confidence — official docs)

### Pattern 3: Cloudflare Worker — Adding POST Route

The existing Worker uses a method guard `if (request.method !== 'GET')`. The new code adds a route check before that guard:

```javascript
// In api-proxy.js — after origin gate, before method guard
const url = new URL(request.url);

// POST /extract-invoice
if (request.method === 'POST' && url.pathname === '/extract-invoice') {
  return handleExtractInvoice(request, env, origin, allowed);
}

// Existing GET-only guard
if (request.method !== 'GET') {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
  });
}
```

The CORS headers function needs `'POST'` added to `Access-Control-Allow-Methods`:

```javascript
function corsHeaders(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',  // add POST
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
  };
}
```

### Pattern 4: Browser Image Resizing Before Base64 Encoding

```javascript
// In extract.js or upload.js — resize blob to max 1500px before encoding
async function resizeImageBlob(blob, maxPx = 1500) {
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  const scale = Math.min(1, maxPx / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const resized = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  canvas.width = 0;
  canvas.height = 0;
  return resized;
}
```

Note: `state.scanPages[]` stores Blobs (not canvases — per Phase 2 decision). After `buildPdfFromPages()` the assembled PDF file is available as `files[i]` (File named `scanned-document.pdf`). For images going as JPEG to Claude (single-page path if desired), the resize function above applies before reading as base64.

### Pattern 5: Blob to Raw Base64 (no data-URL prefix)

The Anthropic API requires raw base64, not the `data:image/jpeg;base64,...` prefix that `FileReader.readAsDataURL()` produces.

```javascript
// Strip the data-URL prefix after FileReader
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;        // "data:image/jpeg;base64,/9j/..."
      const base64 = dataUrl.split(',')[1]; // raw base64 only
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Alternative with arrayBuffer (slightly lower overhead, no prefix to strip):
async function blobToBase64Alt(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);  // browser built-in btoa
}
```

For large PDFs (1-5 MB), the `arrayBuffer` approach avoids creating a very long string twice. Use `btoa()` for files under ~5 MB (browser limit); for larger, chunk encoding is needed but invoices rarely exceed 5 MB raw.

### Pattern 6: Batch Milestone Reset (Single CSV Write)

The existing `markDone()` in unit-detail.js downloads the CSV, mutates one row, and writes. For multiple tags (e.g., 3 milestones), calling it sequentially would trigger 3 CSV downloads and 3 writes with optimistic lock conflicts.

**The correct pattern is one download, N mutations, one write:**

```javascript
// In upload.js — new function, analogous to logic in unit-detail.js
async function batchMarkDone(milestoneTypes, unitId, dateStr, miles, token) {
  const { text, hash } = await downloadCSV(state.fleet.maintenancePath, token);
  const rows = parseCSV(text);
  const doneDate = dateStr || new Date().toISOString().split('T')[0];

  for (const type of milestoneTypes) {
    const idx = rows.findIndex(r => r.UnitId === unitId && r.Type === type);
    if (idx >= 0) {
      rows[idx].LastDoneDate = doneDate;
      rows[idx].LastDoneMiles = String(miles || '');
    } else {
      rows.push({
        MaintId: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        UnitId: unitId,
        Type: type,
        IntervalDays: '',
        IntervalMiles: '',
        LastDoneDate: doneDate,
        LastDoneMiles: String(miles || ''),
        Notes: '',
      });
    }
  }

  const newText = serializeCSV(MAINTENANCE_HEADERS, rows);
  return await writeCSVWithLock(state.fleet.maintenancePath, hash, newText, token);
}
```

Import `downloadCSV`, `parseCSV`, `serializeCSV`, `writeCSVWithLock` from `'../graph/csv.js'` and `MAINTENANCE_HEADERS` from `'../views/unit-detail.js'` or define locally in upload.js to avoid coupling.

**Note:** `markDone()` in unit-detail.js is not exported — it is a module-private function. The batch function above must be implemented directly in upload.js (or a shared maintenance module). Do not attempt to import `markDone` from unit-detail.js.

### Pattern 7: Milestone Tag Picker UI

```javascript
// Horizontal scrollable chip row below form fields
function renderMilestoneTagPicker(unitId, preselected = []) {
  const unit = state.fleet.units.find(u => u.UnitId === unitId);
  const milestones = getMilestonesForCategory(unit?.Type || '');

  const chips = milestones.map(ms => {
    const selected = preselected.includes(ms.type);
    return `<button class="milestone-chip${selected ? ' selected' : ''}"
      data-milestone="${ms.type}"
      data-action="toggle-milestone">
      ${ms.label}
    </button>`;
  }).join('');

  return `<div class="field" id="milestoneTagField" style="display:${milestones.length ? '' : 'none'};">
    <label>Milestones completed</label>
    <div class="milestone-chips" style="display:flex;gap:8px;overflow-x:auto;padding:4px 0;">
      ${chips}
    </div>
  </div>`;
}
```

Event delegation for toggle (consistent with upload.js pattern):
```javascript
container.addEventListener('click', e => {
  const chip = e.target.closest('[data-action="toggle-milestone"]');
  if (chip) chip.classList.toggle('selected');
});
```

Reading selected tags on submit:
```javascript
const selectedTags = [...document.querySelectorAll('.milestone-chip.selected')]
  .map(el => el.dataset.milestone);
```

### Anti-Patterns to Avoid

- **Raw base64 with data-URL prefix to Anthropic API:** The API rejects `data:image/jpeg;base64,...` format. Always strip prefix or use `btoa(binaryString)`.
- **Sequential `markDone()` calls for multiple milestones:** Each call downloads + writes CSV. Use the batch pattern (one download, N mutations, one write) to avoid optimistic lock conflicts.
- **Sending the assembled PDF for extraction before buildPdfFromPages() completes:** `buildPdfFromPages()` is async. The `extractInvoice()` call must await it or be triggered after it resolves.
- **Blocking the scan UI during extraction:** Like the existing OCR pattern, fire extraction non-blocking with `.then()/.catch()` after the scan page is added.
- **Using `markDone` from unit-detail.js directly:** It is not exported. Implement batch logic in upload.js importing from `graph/csv.js` directly.
- **Forgetting to update `corsHeaders()` to include POST:** The existing function only allows GET and OPTIONS. Without POST, the browser preflight will block the request.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Invoice field extraction from images | Custom regex/spatial scoring | Claude Haiku 4.5 via single API call | Handwriting, varied layouts, line items — all require vision |
| PDF multi-page analysis | Page-by-page OCR loop | Claude native PDF document block | Claude handles all pages in one call |
| Image resizing | ImageMagick or server-side resize | Browser Canvas API | Already used in scanner.js; zero dependency |
| Blob to base64 | Custom binary reader | `FileReader.readAsDataURL` or `btoa(...)` | Reliable, cross-browser, zero dependency |
| Multi-page PDF assembly | Custom PDF writer | jsPDF (already in project at 4.2.0) | Already used in `buildPdfFromPages()` |
| CSV optimistic locking for maintenance reset | Custom lock mechanism | `writeCSVWithLock` from `graph/csv.js` | Already battle-tested with hash-check pattern |

**Key insight:** The entire value proposition of this phase is delegating all parsing intelligence to Claude. Any custom string parsing, spatial scoring, or milestone-keyword matching in app code is a regression to the old Tesseract approach.

---

## Common Pitfalls

### Pitfall 1: base64 Data-URL Prefix
**What goes wrong:** `FileReader.readAsDataURL()` returns `"data:image/jpeg;base64,/9j/..."`. If the full string is sent to Anthropic's `source.data`, the API returns a 400 error.
**Why it happens:** FileReader is designed to produce browser-usable data URLs; the prefix is part of that contract.
**How to avoid:** Always `split(',')[1]` after readAsDataURL, or use `btoa()` on the raw ArrayBuffer bytes.
**Warning signs:** Anthropic API returns 400 with a message about invalid base64.

### Pitfall 2: Claude Returns JSON Embedded in Prose
**What goes wrong:** Claude occasionally wraps the JSON in a markdown code block (` ```json ... ``` `) or adds explanatory text before/after.
**Why it happens:** Claude is trained to be helpful; sometimes it adds context even when instructed not to.
**How to avoid:** In the extraction prompt, include `"Return JSON only, no other text."` and in the Worker parse with a regex extraction fallback: try `JSON.parse(text)` first, then try extracting from ` ```json ... ``` ` block, then return an error.
**Warning signs:** `JSON.parse()` throws on the response text.

### Pitfall 3: Cloudflare Worker CORS Preflight Blocks POST
**What goes wrong:** Browser sends OPTIONS preflight before POST. The Worker's current OPTIONS handler returns 204 with `Allow-Methods: GET, OPTIONS` — the browser rejects the POST.
**Why it happens:** The corsHeaders function was written only for GET. POST is a new method.
**How to avoid:** Update `corsHeaders()` to include `'POST'` in `Access-Control-Allow-Methods`.
**Warning signs:** Browser console shows CORS error on OPTIONS preflight before the POST even fires.

### Pitfall 4: Extraction Fires Before PDF Is Ready
**What goes wrong:** For multi-page scans, `buildPdfFromPages()` is async. If `extractInvoice()` fires before it resolves, the old (incomplete) PDF is sent, or no PDF is available.
**Why it happens:** The current camera flow calls `buildPdfFromPages()` with await, then runOCR non-blockingly. If extractInvoice moves to file-ready trigger, the order matters.
**How to avoid:** Trigger extraction at the end of `buildPdfFromPages()` (scan path) or at the end of `handleFiles()` (file upload path) — after the files array is updated.
**Warning signs:** Claude returns null for most fields on multi-page invoices.

### Pitfall 5: Milestone Tag Picker Shows Wrong Category
**What goes wrong:** If unit type is retrieved before the fleet data loads, `getMilestonesForCategory('')` returns only the generic PM fallback.
**Why it happens:** `state.fleet.units` may be empty on first render if fleet data hasn't arrived yet.
**How to avoid:** Re-render the tag picker when the unit selector changes (reuse the existing `#unitId` change listener in upload.js). On extraction result, set unit first, then render tags.
**Warning signs:** Tag picker shows only one chip regardless of unit type.

### Pitfall 6: Sequential Milestone Writes Cause CSV_CONFLICT
**What goes wrong:** Calling `markDone()` in a loop creates a race condition where each call reads the same base hash and all but the first write fail with `CSV_CONFLICT`.
**Why it happens:** `writeCSVWithLock` checks the hash before writing; subsequent calls read the same pre-write hash.
**How to avoid:** Use the batch pattern: single download, mutate all rows in memory, single write.
**Warning signs:** Only the first selected milestone gets recorded; others fail silently.

### Pitfall 7: jsPDF-Assembled PDF Too Large for Anthropic
**What goes wrong:** 5-page scanned invoice PDF (full resolution) might exceed Anthropic's 32 MB request limit after base64 encoding.
**Why it happens:** `buildPdfFromPages()` already resizes via canvas at JPEG 0.8 quality. But very large phone camera images (4000x3000px) might still produce large pages.
**How to avoid:** The planned 1500px resize before base64 encoding applies to the JPEG images going into the PDF. Since `buildPdfFromPages()` already uses JPEG 0.8 in the canvas step, typical invoices will be well under limits. Verify with a 5-page test case.
**Warning signs:** Worker returns 400 from Anthropic with "request too large".

---

## Code Examples

Verified patterns from official sources:

### Worker: handleExtractInvoice function
```javascript
// Source: Anthropic API docs — https://platform.claude.com/docs/en/build-with-claude/vision
async function handleExtractInvoice(request, env, origin, allowed) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
    });
  }

  const { image, mimeType, fleet } = body;
  if (!image || !mimeType) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
    });
  }

  // Build content block based on mime type
  const contentBlock = mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } };

  const fleetList = (fleet || []).join(', ');
  const prompt = `You are analyzing a fleet maintenance invoice. Match the unit/truck/trailer number against this roster: [${fleetList}]. Return JSON only, no other text.

{
  "unit_number": string | null,
  "date": "YYYY-MM-DD" | null,
  "vendor": string | null,
  "vendor_address": string | null,
  "invoice_number": string | null,
  "total_cost": number | null,
  "labor_cost": number | null,
  "parts_cost": number | null,
  "summary": "one-line description of work performed",
  "line_items": [{ "description": string, "amount": number }],
  "detected_milestones": string[],
  "confidence": number
}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: 'upstream_error', detail: err }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    const data = await resp.json();
    const rawText = data.content?.[0]?.text || '';

    // Parse JSON from Claude response (may be wrapped in ```json ... ```)
    let extraction;
    try {
      extraction = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        extraction = JSON.parse(match[1].trim());
      } else {
        throw new Error('Claude response is not valid JSON');
      }
    }

    return new Response(JSON.stringify(extraction), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'extraction_failed', message: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
    });
  }
}
```

### Browser: extract.js client module
```javascript
// app/invoice/extract.js
const WORKER_URL = 'https://camiora-api-proxy.camiora.workers.dev';

/**
 * Send an image/PDF blob to the Worker for Claude extraction.
 * @param {Blob} blob
 * @param {string} mimeType - 'image/jpeg' | 'application/pdf'
 * @param {string[]} fleet - compact list of unit IDs
 * @returns {Promise<Object>} extraction result
 */
export async function extractInvoice(blob, mimeType, fleet) {
  const base64 = await blobToBase64(blob);

  const resp = await fetch(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, mimeType, fleet }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Worker returned ${resp.status}`);
  }

  return resp.json();
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

### upload.js: replacement for runOCR call sites
```javascript
// After buildPdfFromPages() resolves — send assembled PDF to Claude
// (replaces: runOCR(ocrBlob).then(fields => prefillFormFields(fields)))

const fleetIds = state.fleet.units.map(u => u.UnitId).filter(Boolean);
const pdfFile = files.find(f => f.name === 'scanned-document.pdf');
if (pdfFile) {
  extractInvoice(pdfFile, 'application/pdf', fleetIds)
    .then(data => prefillExtractionFields(data))
    .catch(err => console.error('Extraction failed:', err));
}

// For uploaded PDF/image files (replaces ocrFromFile):
extractInvoice(file, file.type || 'application/pdf', fleetIds)
  .then(data => prefillExtractionFields(data))
  .catch(err => console.error('Extraction failed:', err));
```

### wrangler.toml update
```toml
name = "camiora-api-proxy"
main = "api-proxy.js"
compatibility_date = "2024-01-01"

[vars]
ALLOWED_ORIGIN = "https://alexubt.github.io"

# Secrets (set via wrangler secret put):
#   SAMSARA_API_KEY
#   ANTHROPIC_API_KEY
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tesseract.js local OCR | Claude Haiku 4.5 vision API | This phase | Handwriting support, line items, vendor data, multi-field in one call |
| pdf.js first-page render for OCR | Claude native PDF document block | This phase | Full document analysis, no page limit (100 pages), no pdf.js dependency |
| Spatial scoring (scoreUnitNumber, scoreDate, scoreServiceType) | Fleet-roster-aware LLM matching | This phase | Claude handles irregular formats; entire scoring system deleted |
| Single service type field | Milestone tag multi-select chip row | This phase | Multiple maintenance types per invoice; auto-reset on upload |
| Manual cost entry | Claude-extracted total_cost pre-fill | This phase | Reduces manual entry; user can still edit |

**Deprecated/outdated in this project:**
- `app/imaging/ocr.js`: entire file deleted
- `app/imaging/ocr.test.js`: entire file deleted
- pdf.js CDN import in upload.js: `renderPdfPageToBlob()` deleted
- Tesseract CDN script injection in ocr.js: deleted with the file
- `#ocrResults` and `#ocrRawDetails` HTML elements and CSS: deleted from upload.js renderApp()
- Service type `<select>` with hardcoded options: replaced by text field + milestone chips (or kept for legacy fallback — Claude's discretion)

---

## Open Questions

1. **Service type field retention after milestone tag picker**
   - What we know: Current form has a `<select id="serviceType">` that determines the OneDrive folder path (DOT inspections go to a different folder). The milestone tag picker replaces multi-type selection but the `serviceType` field still drives `getDocType()` and `buildFolderPath()`.
   - What's unclear: Should the service type dropdown remain for folder routing, or should one of the detected_milestones be used to determine folder path?
   - Recommendation: Keep the `serviceType` select for folder routing purposes (it only affects DOT Inspection vs Invoices); the new milestone chips are separate from folder routing. Claude's `detected_milestones` pre-populates chips but does NOT auto-set `serviceType`. User keeps both controls.

2. **WORKER_URL in extract.js vs sync.js**
   - What we know: `app/samsara/sync.js` hardcodes `const WORKER_URL = 'https://camiora-samsara-proxy.camiora.workers.dev'`. After rename, both files need the new URL.
   - What's unclear: The new Worker name and URL are not yet confirmed (depends on `wrangler.toml` name field after rename).
   - Recommendation: Use `camiora-api-proxy` as the worker name → URL becomes `https://camiora-api-proxy.camiora.workers.dev`. Update both `sync.js` and the new `extract.js`. Consider a shared constant in `app/state.js` or `app/graph/auth.js` to avoid drift.

3. **Samsara mileage availability at upload time**
   - What we know: `state.fleet.maintenanceData` and Samsara mileage are loaded on-demand per unit in unit-detail.js. The upload view does not currently load per-unit maintenance data.
   - What's unclear: When milestone reset fires on upload, what mileage value is available? `state` may not have the current Samsara mileage for the selected unit in the upload view.
   - Recommendation: Query `state.fleet.units` for the selected unit's `CurrentMiles` from condition.csv (already loaded at boot). If not available, pass `''` as miles (maintenance.csv LastDoneMiles will be blank). This matches the existing behavior in handleMilestoneDone when miles are unknown.

---

## Validation Architecture

> `nyquist_validation` is enabled in .planning/config.json.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in, v18+) |
| Config file | none — run directly via `node --test` |
| Quick run command | `node --test app/invoice/extract.test.js` |
| Full suite command | `node --test app/**/*.test.js worker/**/*.test.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OCR-01 (replaced) | extractInvoice() sends correct request format to Worker | unit | `node --test app/invoice/extract.test.js` | Wave 0 |
| OCR-02 (replaced) | prefillExtractionFields() populates unit, date, cost, vendor, invoice# from extraction result | unit | `node --test app/invoice/extract.test.js` | Wave 0 |
| OCR-03 (replaced) | Tag picker renders AI-detected milestones pre-selected; toggle works | manual (DOM) | manual browser test | N/A |
| Phase milestone reset | batchMarkDone() mutates all rows and writes once | unit | `node --test app/invoice/batchMilestone.test.js` | Wave 0 |
| Worker route | POST /extract-invoice returns structured JSON | unit | `node --test worker/api-proxy.test.js` | Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test app/invoice/extract.test.js`
- **Per wave merge:** `node --test app/**/*.test.js worker/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `app/invoice/extract.test.js` — covers OCR-01, OCR-02 (mock fetch, assert request body format, assert field mapping)
- [ ] `worker/api-proxy.test.js` — covers Worker route (mock env.ANTHROPIC_API_KEY, mock upstream fetch, assert CORS headers on POST/OPTIONS)
- [ ] `app/invoice/batchMilestone.test.js` — covers batch milestone reset (mock downloadCSV/writeCSVWithLock, assert single write call, assert all rows updated)

---

## Sources

### Primary (HIGH confidence)
- [Anthropic Vision Docs](https://platform.claude.com/docs/en/build-with-claude/vision) — image content block format, base64 encoding, size limits (5 MB/image, 32 MB request), max 1568px recommendation
- [Anthropic PDF Support Docs](https://platform.claude.com/docs/en/docs/build-with-claude/pdf-support) — document content block format, media_type: application/pdf, 32 MB limit, all active models supported
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — confirmed model IDs: `claude-haiku-4-5-20251001` (alias: `claude-haiku-4-5`); context 200k tokens; $1/$5 per MTok input/output
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) — 100 MB inbound request limit (Free/Pro), CPU 30s default (5 min configurable), no hard subrequest timeout

### Secondary (MEDIUM confidence)
- [Cloudflare Community — subrequest timeout](https://community.cloudflare.com/t/worker-subrequest-fetch-90-sec-timeout/763362) — observed 90s upstream fetch timeout (unofficial); Claude's 3-5s response well within this
- [Cloudflare Changelog — 5-minute CPU](https://developers.cloudflare.com/changelog/post/2025-03-25-higher-cpu-limits/) — confirms CPU time increase to 5 minutes available

### Tertiary (LOW confidence — marked for validation)
- Claude Haiku 4.5 pricing $1/$5 per MTok — stated in model overview docs (HIGH actually) but the exact cost-per-invoice estimate of $0.001-$0.005 is training data inference

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — confirmed model IDs, API formats from official Anthropic docs
- Architecture: HIGH — Worker pattern is straightforward extension of existing code; all source files read
- Pitfalls: HIGH — CORS/base64 prefix/batch write issues are verifiable from code review and API docs
- Cost estimates: MEDIUM — based on token count formulas from docs, not measured invoices

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (Anthropic API stable; Cloudflare limits rarely change; model ID aliases are versioned)

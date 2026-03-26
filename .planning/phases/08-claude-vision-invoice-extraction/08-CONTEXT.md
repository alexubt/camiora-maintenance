# Phase 8: Claude Vision Invoice Extraction - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning
**Source:** PRD Express Path (architecture idea document)

<domain>
## Phase Boundary

Replace the entire Tesseract.js OCR pipeline with Claude Haiku Vision via a Cloudflare Worker proxy. One API call per invoice extracts all metadata: unit number, date, vendor, cost, invoice number, summary, line items, and detected maintenance types. Add a milestone tag picker UI that auto-selects AI-detected milestones and allows manual adjustment. Remove Tesseract.js, spatial scoring, and pdf.js (for OCR) dependencies. This phase must be complete and bulletproof — no deferred items.

</domain>

<decisions>
## Implementation Decisions

### OCR Engine
- Drop Tesseract.js entirely — Claude Haiku 4.5 replaces it
- One API call per invoice, no retries unless network failure
- Claude reads both images (JPEG base64) and PDFs (PDF base64) natively

### Cloudflare Worker
- Rename `worker/samsara-proxy.js` → `worker/api-proxy.js` (handles both Samsara and invoice routes)
- Add `/extract-invoice` POST route alongside existing `/vehicles/stats` GET route
- Anthropic API key stored as Worker secret (ANTHROPIC_API_KEY)
- Samsara API key remains as existing secret (SAMSARA_API_KEY)
- Origin-locked to GitHub Pages domain (same CORS pattern as Samsara proxy)
- Update `worker/wrangler.toml` with new name

### Data Flow
- Camera scan: JPEG → Claude Worker for extraction + jsPDF → PDF → OneDrive for filing
- PDF upload: PDF → Claude Worker directly for extraction + same PDF → OneDrive
- No pdf.js rendering needed for uploaded PDFs — Claude reads PDFs natively
- For multi-page scans: all pages assembled into PDF via jsPDF first, then PDF sent to Claude

### Fleet Matching
- Full fleet roster sent in the Claude prompt as compact comma-separated list
- Claude matches unit numbers (including handwritten) directly against the roster
- No pattern config needed — adapts automatically when naming conventions change
- Only complete, confident matches — no partial number guessing

### Milestone Detection + Tag Picker
- Claude detects maintenance types from invoice text and returns them in the response
- Tag picker UI pre-selects AI-detected milestones automatically
- User can confirm, add, or remove tags before upload
- Both AI-detected and manual tag selection work together
- Tags derived from `getMilestonesForCategory(unitType)` for the selected unit's category
- Horizontal scrollable chip/pill row below form fields
- On upload: `markDone()` called for each selected tag with invoice date + current Samsara mileage

### Invoice Detail Extraction
- Extract line items where possible (parts vs labor breakdown)
- Extract invoice number if present
- Extract vendor name and address/phone if present
- Extract total cost (number)
- Generate one-line summary of work performed

### Multi-page Support
- For camera scans: user scans multiple pages, all assembled into multi-page PDF via jsPDF, entire PDF sent to Claude
- For uploaded PDFs: all pages analyzed, not just page 1
- Claude summarizes across all pages

### Cost Optimization
- Claude Haiku 4.5 (~$0.001-0.005 per invoice)
- Images resized to max 1500px before base64 encoding (fewer tokens)
- Fleet roster sent as compact comma-separated list, not full unit objects
- One API call per invoice — no multi-step chains
- Estimated: ~$1/month for 50 invoices/week

### Worker Route Contract

```
POST /extract-invoice
Request:
  Content-Type: application/json
  Body: {
    image: <base64>,
    mimeType: "image/jpeg" | "application/pdf",
    fleet: ["1108", "1115", "1165", ...]
  }

Claude Prompt:
  "You are analyzing a fleet maintenance invoice. Extract the following from
   the document. Match the unit/truck/trailer number against this fleet roster:
   [1108, 1115, 1165, ...]. Return JSON only.

   {
     unit_number: string | null,
     date: 'YYYY-MM-DD' | null,
     vendor: string | null,
     vendor_address: string | null,
     invoice_number: string | null,
     total_cost: number | null,
     labor_cost: number | null,
     parts_cost: number | null,
     summary: string (one-line description of work performed),
     line_items: [{ description: string, amount: number }] | [],
     detected_milestones: string[] (e.g. ['PM', 'dpf-cleaning', 'transmission-oil']),
     confidence: number (0-1)
   }"

Response:
  {
    unit_number, date, vendor, vendor_address, invoice_number,
    total_cost, labor_cost, parts_cost, summary,
    line_items, detected_milestones, confidence
  }
```

### Upload Flow (Updated)

1. User scans document (one or more pages) or uploads PDF/image
2. For scans: pages assembled into multi-page PDF via jsPDF
3. App sends image/PDF base64 + fleet roster to Worker
4. Worker calls Claude Haiku → returns structured extraction
5. Form auto-fills: unit number (dropdown), date, vendor, cost, invoice number
6. Summary displayed in a read-only field
7. Line items shown if available (parts vs labor breakdown)
8. **Milestone tag picker** — AI-detected milestones pre-selected, user confirms/adjusts
9. User confirms → PDF uploaded to OneDrive
10. Invoice record appended to invoices.csv (including vendor, cost, invoice number)
11. Selected milestones reset in maintenance.csv with invoice date + current Samsara mileage

### Files to Remove
- `app/imaging/ocr.js` — entire Tesseract pipeline
- `app/imaging/ocr.test.js` — Tesseract tests
- pdf.js lazy-loading in upload.js (keep jsPDF for scan-to-PDF)
- Tesseract.js CDN script loading
- Spatial scoring system (scoreUnitNumber, scoreDate, scoreServiceType)
- `#ocrResults` and `#ocrRawDetails` debug panels

### Files to Modify
- `app/views/upload.js` — replace `runOCR()` with `extractInvoice()`, add tag picker, milestone reset on upload, show extraction results (summary, line items, cost breakdown)
- `worker/samsara-proxy.js` → rename to `worker/api-proxy.js` — add `/extract-invoice` route with Anthropic API call
- `worker/wrangler.toml` — update worker name if renamed
- `sw.js` — remove ocr.js from cache list, add extract.js, update version
- `app/samsara/sync.js` — update WORKER_URL if worker is renamed

### Files to Create
- `app/invoice/extract.js` — thin client that sends image/PDF to Worker and parses response

### Claude's Discretion
- Error handling and retry strategy for Worker API failures
- Loading/spinner UI during extraction (typically 3-5 seconds)
- How to handle extraction failures gracefully (fallback to manual entry)
- Confidence display (show score or just highlight low-confidence fields)
- Line items display format (table vs list)

</decisions>

<specifics>
## Specific Ideas

### Cost Estimates

| Volume | Monthly Cost |
|--------|-------------|
| 50 invoices/week | ~$1.00/month |
| 100 invoices/week | ~$2.00/month |
| 200 invoices/month (worst case) | ~$3.00/month |

### Milestone Type Mapping for Claude
Claude should map common invoice descriptions to these milestone types:
- "PM", "preventive maintenance", "oil change", "lube" → `PM`
- "DPF", "DOC", "diesel particulate" → `dpf-cleaning`
- "transmission oil", "trans service" → `transmission-oil`
- "differential oil", "diff oil" → `differential-oil`
- "engine air filter", "air filter" → `engine-air-filter`
- "air dryer", "desiccant" → `air-dryer`
- "belts", "tensioner" → `belts-tensioners`
- "brake", "brake inspection" → `brake-inspection`
- "alignment" → `alignment`
- "steer tire", "new steers" → `steer-tires`
- "drive tire", "new drives" → `drive-tires`

This mapping lives in the Claude prompt, not in app code.

</specifics>

<deferred>
## Deferred Ideas

None — this phase must be complete and bulletproof. All extraction, matching, summarization, line items, milestone detection, milestone reset, and multi-format support ships in this phase.

</deferred>

---

*Phase: 08-claude-vision-invoice-extraction*
*Context gathered: 2026-03-26 via PRD Express Path*

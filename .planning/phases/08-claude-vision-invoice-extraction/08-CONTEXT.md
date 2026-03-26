# Phase 8: Claude Vision Invoice Extraction - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning
**Source:** PRD Express Path (architecture idea document)

<domain>
## Phase Boundary

Replace the entire Tesseract.js OCR pipeline with Claude Haiku Vision via a Cloudflare Worker proxy. One API call per invoice extracts unit number, date, vendor, cost, and summary. Add a milestone tag picker UI so users can select which maintenance milestones to reset on upload. Remove Tesseract.js, spatial scoring, and pdf.js (for OCR) dependencies.

</domain>

<decisions>
## Implementation Decisions

### OCR Engine
- Drop Tesseract.js entirely — Claude Haiku 4.5 replaces it
- One API call per invoice, no retries unless network failure
- Claude reads both images (JPEG base64) and PDFs (PDF base64) natively

### Cloudflare Worker
- Extend existing `camiora-samsara-proxy` worker with `/extract-invoice` POST route
- Anthropic API key stored as Worker secret (ANTHROPIC_API_KEY)
- Origin-locked to GitHub Pages domain (same pattern as Samsara proxy)

### Data Flow
- Camera scan: JPEG → Claude Worker for extraction + jsPDF → PDF → OneDrive for filing
- PDF upload: PDF → Claude Worker directly for extraction + same PDF → OneDrive
- No pdf.js rendering needed for uploaded PDFs

### Fleet Matching
- Full fleet roster sent in the Claude prompt as compact comma-separated list
- Claude matches unit numbers (including handwritten) directly against the roster
- No pattern config needed — adapts automatically when naming conventions change

### Milestone Tag Picker
- User manually selects which milestones to reset (not AI-detected)
- Horizontal scrollable chip/pill row below form fields
- Tags derived from `getMilestonesForCategory(unitType)` for the selected unit
- On upload: `markDone()` called for each selected tag with invoice date + current Samsara mileage

### Cost Optimization
- Claude Haiku 4.5 (~$0.001-0.005 per invoice)
- Images resized to max 1500px before base64 encoding
- Fleet roster sent as compact list, not full objects
- Estimated: ~$1/month for 50 invoices/week

### Claude's Discretion
- Error handling and retry strategy for Worker API failures
- Loading/spinner UI during extraction (typically 3-5 seconds)
- How to handle extraction failures gracefully (fallback to manual entry)
- Whether to show confidence scores or just the extracted values
- Invoice summary display format (inline field vs expandable section)

</decisions>

<specifics>
## Specific Ideas

### Worker Route Contract
```
POST /extract-invoice
Body: { image: <base64>, mimeType: "image/jpeg"|"application/pdf", fleet: ["1108","1115",...] }
Response: { unit_number, date, vendor, total_cost, summary, confidence }
```

### Files to Remove
- `app/imaging/ocr.js` — entire Tesseract pipeline
- `app/imaging/ocr.test.js` — Tesseract tests
- pdf.js lazy-loading in upload.js (keep jsPDF)
- Tesseract.js CDN script loading

### Files to Modify
- `app/views/upload.js` — replace `runOCR()` with `extractInvoice()`, add tag picker, milestone reset on upload
- `worker/samsara-proxy.js` — add `/extract-invoice` route (consider renaming to `api-proxy.js`)
- `sw.js` — remove ocr.js from cache list, update version

### Files to Create
- `app/invoice/extract.js` — thin client that sends image/PDF to Worker

</specifics>

<deferred>
## Deferred Ideas

- AI-powered milestone detection from invoice text (currently manual tag selection)
- Invoice line-item extraction (parts vs labor breakdown)
- Multi-page invoice support (currently first page only for scans)
- Receipt emailer integration (separate todo exists)

</deferred>

---

*Phase: 08-claude-vision-invoice-extraction*
*Context gathered: 2026-03-26 via PRD Express Path*

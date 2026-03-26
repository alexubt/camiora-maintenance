---
phase: 08-claude-vision-invoice-extraction
plan: 01
subsystem: api
tags: [cloudflare-workers, anthropic, claude-haiku, cors, base64, invoice-extraction]

requires:
  - phase: 06-onedrive-and-offline
    provides: "Cloudflare Worker (samsara-proxy) pattern for CORS-gated API proxy"

provides:
  - "worker/api-proxy.js — Cloudflare Worker with GET /vehicles/stats and POST /extract-invoice routes"
  - "Claude Haiku 4.5 vision extraction endpoint accepting base64 image/jpeg and application/pdf"
  - "Structured JSON extraction: unit_number, date, vendor, cost, summary, line_items, detected_milestones, confidence"
  - "worker/api-proxy.test.js — 9 passing unit tests for all route behaviors"

affects:
  - 08-02-upload-integration
  - app/invoice/extract.js (next plan creates this client)

tech-stack:
  added: []
  patterns:
    - "globalThis.fetch mock pattern for Cloudflare Worker unit tests"
    - "Markdown code-block fallback for Claude JSON response parsing"
    - "Fleet roster embedded in prompt as compact comma-separated list"

key-files:
  created:
    - worker/api-proxy.js
    - worker/api-proxy.test.js
  modified:
    - worker/wrangler.toml
    - worker/package.json

key-decisions:
  - "worker/package.json type changed from commonjs to module to support ES imports in tests"
  - "Original samsara-proxy.js left intact — user decommissions after deploying api-proxy"
  - "Claude model: claude-haiku-4-5-20251001 with max_tokens: 1024"
  - "PDF uses document content block; images use image content block — both with source.type: base64"
  - "JSON parsing tries raw JSON first, falls back to markdown regex extraction before returning 502"

patterns-established:
  - "Pattern: Worker route dispatch — POST /extract-invoice checked before GET-only guard"
  - "Pattern: corsHeaders() extended to 'GET, POST, OPTIONS' for invoice route"

requirements-completed: [VIS-01]

duration: 8min
completed: 2026-03-26
---

# Phase 8 Plan 01: Worker api-proxy with Claude Haiku Invoice Extraction Summary

**Cloudflare Worker renamed api-proxy with POST /extract-invoice route calling Claude Haiku 4.5 Vision API for structured invoice data extraction from JPEG images and PDFs**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-26T22:52:11Z
- **Completed:** 2026-03-26T23:00:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added POST /extract-invoice route to the existing Cloudflare Worker alongside Samsara GET proxy
- Implemented full Anthropic Messages API integration with image and PDF content blocks, fleet roster prompt, and markdown-JSON fallback parsing
- All 9 unit tests pass covering: CORS preflight, image extraction, PDF extraction, missing fields, invalid JSON, upstream errors, markdown wrapping, unauthorized origin, and Samsara route preservation

## Task Commits

1. **Task 1: Rename Worker and add /extract-invoice POST route** - `47fb2c6` (feat)
2. **Task 2: Unit tests for Worker /extract-invoice route** - `26822b9` (test)

## Files Created/Modified

- `worker/api-proxy.js` - New Worker entry point: Samsara GET proxy + Claude Haiku invoice extraction POST route
- `worker/api-proxy.test.js` - 9 unit tests using node:test with globalThis.fetch mocking
- `worker/wrangler.toml` - Updated name to camiora-api-proxy and main to api-proxy.js; added ANTHROPIC_API_KEY comment
- `worker/package.json` - Changed type from commonjs to module to enable ES imports in tests

## Decisions Made

- Left `worker/samsara-proxy.js` intact — user deploys api-proxy first and decommissions samsara-proxy manually afterward
- Changed `worker/package.json` to `"type": "module"` — required for node:test to load ES module Worker file
- Used `claude-haiku-4-5-20251001` as the model ID (research-validated exact ID)
- Prompt embeds fleet roster as comma-separated list and milestone type mapping hints inline

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed worker/package.json type to enable ES module imports**
- **Found during:** Task 2 (running tests)
- **Issue:** `"type": "commonjs"` in package.json caused `SyntaxError: Cannot use import statement outside a module` when running node --test api-proxy.test.js
- **Fix:** Changed `"type": "commonjs"` to `"type": "module"` in worker/package.json
- **Files modified:** worker/package.json
- **Verification:** All 9 tests pass after change
- **Committed in:** 47fb2c6 (Task 1 commit, included with Worker files)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential — tests could not run without this fix. No scope creep.

## Issues Encountered

- worker/package.json had `"type": "commonjs"` which blocked the node:test runner from loading the ES module Worker file. Fixed by switching to `"type": "module"`.

## User Setup Required

**External services require manual configuration before the Worker can be deployed:**

1. **Deploy the Worker:**
   ```
   cd worker && wrangler deploy
   ```

2. **Set the Anthropic API key secret:**
   ```
   cd worker && wrangler secret put ANTHROPIC_API_KEY
   ```
   Get your API key from: Anthropic Console → API keys → Create key

3. **Verify:** The old samsara-proxy Worker can be decommissioned via the Cloudflare dashboard after verifying api-proxy is live.

## Next Phase Readiness

- Worker /extract-invoice endpoint is ready for browser client integration
- Next: create `app/invoice/extract.js` thin client and replace `runOCR()` in upload.js
- ANTHROPIC_API_KEY secret must be set in Cloudflare before end-to-end testing

---
*Phase: 08-claude-vision-invoice-extraction*
*Completed: 2026-03-26*

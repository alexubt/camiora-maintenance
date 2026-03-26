---
phase: 8
slug: claude-vision-invoice-extraction
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-26
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner |
| **Config file** | none — uses `node --test` |
| **Quick run command** | `node --test app/**/*.test.js` |
| **Full suite command** | `node --test app/**/*.test.js` |
| **Estimated runtime** | ~0.5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test app/**/*.test.js`
- **After every plan wave:** Run `node --test app/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 08-01-01 | 01 | 1 | VIS-01 | integration | `curl -s -H "Origin: https://alexubt.github.io" -X POST worker-url/extract-invoice` | ⬜ pending |
| 08-01-02 | 01 | 1 | VIS-01 | deploy | `cd worker && npx wrangler deploy` | ⬜ pending |
| 08-02-01 | 02 | 2 | VIS-02, VIS-06 | unit | `node --test app/invoice/extract.test.js` | ⬜ pending |
| 08-02-02 | 02 | 2 | VIS-03, VIS-07 | manual | Load app, scan/upload invoice, verify form auto-fills | ⬜ pending |
| 08-03-01 | 03 | 3 | VIS-04 | manual | Load unit detail, verify milestone chips render for unit type | ⬜ pending |
| 08-03-02 | 03 | 3 | VIS-05 | manual | Upload invoice with tags selected, verify maintenance.csv updated | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Node.js test runner already configured. No additional framework needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Handwriting recognition | VIS-02 | Requires real handwritten invoice image | Scan invoice with handwritten unit number, verify correct extraction |
| PDF extraction | VIS-06 | Requires real PDF upload | Upload a multi-page PDF invoice, verify all pages analyzed |
| Milestone tag pre-selection | VIS-04 | Requires AI detection output | Upload invoice for PM service, verify PM chip is pre-selected |
| Batch milestone reset | VIS-05 | Requires OneDrive write verification | Select 2+ milestone tags, upload, check maintenance.csv on OneDrive |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual verification steps
- [x] Sampling continuity: no 3 consecutive tasks without verification
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

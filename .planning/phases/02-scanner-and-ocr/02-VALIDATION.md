---
phase: 2
slug: scanner-and-ocr
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, zero dependency) |
| **Config file** | none — run via `node --test` |
| **Quick run command** | `node --test app/imaging/scanner.test.js app/imaging/ocr.test.js` |
| **Full suite command** | `node --test app/**/*.test.js` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test app/imaging/scanner.test.js app/imaging/ocr.test.js`
- **After every plan wave:** Run `node --test app/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | SCAN-01 | unit | `node --test app/imaging/scanner.test.js` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | SCAN-02 | unit | `node --test app/imaging/scanner.test.js` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | SCAN-03 | unit | `node --test app/imaging/scanner.test.js` | ❌ W0 | ⬜ pending |
| 2-01-04 | 01 | 1 | SCAN-04 | smoke | `grep "jspdf@4" index.html` | N/A | ⬜ pending |
| 2-02-01 | 02 | 2 | OCR-01 | unit | `node --test app/imaging/ocr.test.js` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 2 | OCR-02 | unit | `node --test app/imaging/ocr.test.js` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 2 | OCR-03 | manual | Manual: browser test | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/imaging/scanner.test.js` — covers SCAN-01 (threshold), SCAN-02 (skew angle), SCAN-03 (blob + canvas release)
- [ ] `app/imaging/ocr.test.js` — covers OCR-01, OCR-02 with fixture text strings
- [ ] No test runner install needed — `node --test` is built-in

*Note: Image processing functions use DOM APIs. Tests cover pure computation only (threshold logic with raw arrays, angle calculation with known coords, text parsing).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| B&W filter produces scanned look | SCAN-01 | Visual quality assessment | Scan an invoice, compare before/after |
| Deskew straightens crooked photo | SCAN-02 | Visual + device camera | Take crooked photo, verify auto-straighten |
| No crash after 5+ sequential scans | SCAN-03 | iOS memory limit, device-specific | Scan 5 invoices in a row on iPhone |
| OCR pre-fills correct fields | OCR-03 | Requires live camera + DOM | Scan invoice, verify fields auto-populated |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

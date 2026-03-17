---
phase: 3
slug: invoice-workflow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none |
| **Quick run command** | `node --test app/views/upload.test.js app/graph/invoices.test.js` |
| **Full suite command** | `node --test app/**/*.test.js` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test app/views/upload.test.js app/graph/invoices.test.js`
- **After every plan wave:** Run `node --test app/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | INV-01 | unit | `node --test app/views/upload.test.js` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | INV-02 | unit | `node --test app/views/upload.test.js` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | INV-03 | unit | `node --test app/views/upload.test.js` | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 1 | INV-04 | unit | `node --test app/views/upload.test.js` | ❌ W0 | ⬜ pending |
| 3-01-05 | 01 | 1 | INV-05 | unit | `node --test app/views/upload.test.js` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 2 | INV-06 | unit | `node --test app/graph/invoices.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/views/upload.test.js` — covers INV-01 through INV-05 (pure function extractions: getBaseName, buildFolderPath, getServiceLabel)
- [ ] `app/graph/invoices.test.js` — covers INV-06 (appendInvoiceRecord with mocked fetch)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Unit dropdown populates from CSV | INV-01 | Requires DOM + live Graph API | Load app, verify dropdown shows fleet units |
| Filename preview updates live | INV-04 | DOM interaction | Select unit/date/type, verify preview text |
| PDF lands in correct OneDrive folder | INV-05 | Live Graph API + OneDrive | Upload invoice, check OneDrive folder |
| Invoice record appended to CSV | INV-06 | Live Graph API | Upload invoice, download invoices.csv, verify row |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

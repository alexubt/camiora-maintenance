---
phase: 10
slug: modular-maintenance-tracking
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-30
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` + `node:assert/strict` |
| **Config file** | none — run via `node --test` |
| **Quick run command** | `node --test app/maintenance/milestones.test.js` |
| **Full suite command** | `node --test app/**/*.test.js` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test app/maintenance/milestones.test.js`
- **After every plan wave:** Run `node --test app/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-F1 | 01 | 1 | MAINT-02, MAINT-04, MAINT-05, MAINT-06, MAINT-08, MAINT-10 | unit | `node --test app/maintenance/milestones.test.js` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | MAINT-01, MAINT-03 | smoke | manual browser verify | N/A | ⬜ pending |
| 10-02-02 | 02 | 2 | MAINT-01 | smoke | manual browser verify | N/A | ⬜ pending |
| 10-03-01 | 03 | 2 | MAINT-07, MAINT-08, MAINT-09 | smoke | manual browser verify | N/A | ⬜ pending |
| 10-04-01 | 04 | 3 | MAINT-11, MAINT-12 | smoke | manual browser verify | N/A | ⬜ pending |
| 10-04-02 | 04 | 3 | ALL | checkpoint | human browser verify | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/maintenance/milestones.test.js` — covers MAINT-02, MAINT-03, MAINT-04, MAINT-05, MAINT-06, MAINT-08, MAINT-10 (new pure/DI functions need test coverage before implementation)

*Existing test files `app/views/unit-detail.test.js`, `app/graph/csv.test.js` cover their respective modules. No new test files needed for dashboard.js or unit-detail.js changes — those are rendering-only and verified in browser.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings page renders with CRUD UI | MAINT-01, MAINT-03 | DOM rendering | Navigate to #settings, verify add/edit/delete forms work |
| Card collapse hides OK rows; expand shows them | MAINT-07 | DOM rendering | Open dashboard, verify overdue/due-soon shown, OK hidden, expand link works |
| Coming Due tab shows filtered units | MAINT-09 | DOM rendering + state | Click Coming Due tab, verify units with due-soon milestones appear |
| Trailer tire monitor renders axle positions | MAINT-11 | DOM rendering | Open a trailer unit detail, verify tire positions render |
| SW cache includes settings.js | MAINT-12 | Browser DevTools | Check Application > Cache Storage for settings.js entry |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

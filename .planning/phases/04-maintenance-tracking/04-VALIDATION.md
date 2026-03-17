---
phase: 4
slug: maintenance-tracking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none |
| **Quick run command** | `node --test app/maintenance/schedule.test.js` |
| **Full suite command** | `node --test app/**/*.test.js` |
| **Estimated runtime** | ~4 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test app/maintenance/schedule.test.js`
- **After every plan wave:** Run `node --test app/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | FLEET-03 | unit | `node --test app/maintenance/schedule.test.js` | ❌ W0 | ⬜ pending |
| 4-01-02 | 01 | 1 | FLEET-04 | unit | `node --test app/maintenance/schedule.test.js` | ❌ W0 | ⬜ pending |
| 4-02-01 | 02 | 2 | FLEET-02 | unit | `node --test app/views/unit-detail.test.js` | ❌ W0 | ⬜ pending |
| 4-02-02 | 02 | 2 | FLEET-05 | unit | `node --test app/views/unit-detail.test.js` | ❌ W0 | ⬜ pending |
| 4-02-03 | 02 | 2 | FLEET-06 | unit | `node --test app/views/unit-detail.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/maintenance/schedule.js` — pure functions: isOverdue, getDueDate, getDueMiles
- [ ] `app/maintenance/schedule.test.js` — covers FLEET-03 (due date calc) and FLEET-04 (overdue detection)
- [ ] `app/views/unit-detail.test.js` — covers FLEET-02, FLEET-05, FLEET-06 with DI pattern

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Invoice history renders on unit page | FLEET-02 | DOM + live Graph API | Navigate to #unit?id=X, verify invoice table |
| PM schedule form saves to OneDrive | FLEET-03 | Live Graph API | Configure PM interval, verify maintenance.csv |
| Overdue items visually flagged | FLEET-04 | Visual styling | Set past due date, verify red/warning badge |
| Condition data editable | FLEET-05 | DOM + live API | Update mileage, verify condition.csv |
| Unit detail page loads all sections | FLEET-06 | Full integration | Navigate to unit, verify history + condition + PM |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

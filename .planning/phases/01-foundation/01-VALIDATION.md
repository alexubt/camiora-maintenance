---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (node --test, Node 18+) |
| **Config file** | none — Wave 0 creates test files |
| **Quick run command** | `node --test app/graph/csv.test.js` |
| **Full suite command** | `node --test app/**/*.test.js` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test app/graph/csv.test.js`
- **After every plan wave:** Run `node --test app/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | FLEET-01 | unit | `node --test app/graph/csv.test.js` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | FLEET-01 | unit | `node --test app/graph/csv.test.js` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | FLEET-07 | unit | `node --test app/graph/csv.test.js` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | FLEET-07 | unit | `node --test app/graph/csv.test.js` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | FLEET-07 | unit | `node --test app/graph/csv.test.js` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | INFRA-04 | smoke | Manual: open browser, check DevTools console | N/A | ⬜ pending |
| 1-02-02 | 02 | 1 | INFRA-04 | smoke | Manual: navigate to /#upload | N/A | ⬜ pending |
| 1-03-01 | 03 | 1 | FLEET-01 | smoke | Manual: load app, verify dropdown | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/graph/csv.test.js` — stubs for FLEET-01 (parseCSV, 404 handling) and FLEET-07 (hash consistency, lock conflict)
- [ ] No test runner install needed — `node --test` is built-in to Node 18+

*Rationale: No npm, no build step, no package.json. Pure function tests for CSV parsing and hashing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| App loads from ES modules without JS errors | INFRA-04 | Requires browser DOM | Open app, check DevTools console for errors |
| Hash route switches views | INFRA-04 | Requires browser navigation | Navigate to /#upload, verify form renders |
| Unit roster dropdown populates | FLEET-01 | Requires browser DOM + Graph API auth | Load app, verify dropdown shows units from CSV |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

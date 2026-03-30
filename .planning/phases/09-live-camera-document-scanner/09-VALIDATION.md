---
phase: 9
slug: live-camera-document-scanner
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
---

# Phase 9 — Validation Strategy

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
| 09-01-01 | 01 | 1 | LIVE-01, LIVE-03 | unit | `node --test app/imaging/scanner-core.test.js` | ⬜ pending |
| 09-01-02 | 01 | 1 | LIVE-02 | unit | `node -e "import('./app/imaging/detect-worker.js')"` | ⬜ pending |
| 09-02-01 | 02 | 2 | LIVE-04, LIVE-05, LIVE-06 | manual | Open app on phone, verify viewfinder opens with green overlay | ⬜ pending |
| 09-02-02 | 02 | 2 | LIVE-05 | manual | Verify CSS classes render correctly in dark mode | ⬜ pending |
| 09-03-01 | 03 | 3 | LIVE-07, LIVE-08 | manual | Scan multi-page invoice, verify single PDF assembly on "Done" | ⬜ pending |
| 09-03-02 | 03 | 3 | LIVE-09 | automated | `grep scanner-core sw.js && grep detect-worker sw.js && grep live-scanner sw.js` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Node.js test runner already configured. No additional framework needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| getUserMedia viewfinder | LIVE-04 | Requires camera hardware | Open app on phone, tap scan, verify live camera feed appears |
| Real-time green quad overlay | LIVE-05 | Requires camera + document | Hold phone over a document, verify green quad appears and tracks edges smoothly |
| Tap-to-capture + thumbnail | LIVE-06 | Requires camera interaction | Tap capture, verify thumbnail appears in bottom strip, verify page added |
| Multi-page → Done → Claude | LIVE-07, LIVE-08 | Requires full upload flow | Scan 2+ pages, tap Done, verify single PDF assembled and Claude extraction fires |
| getUserMedia fallback | LIVE-07 | Requires denying camera permission | Deny camera permission, verify falls back to native camera input |
| iOS Safari compatibility | LIVE-04 | Requires iOS device | Test on iPhone Safari — verify playsinline, camera resolution, worker loads |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual verification steps
- [x] Sampling continuity: no 3 consecutive tasks without verification
- [x] No watch-mode flags
- [x] Feedback latency < 2s for automated tests
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---
phase: 10-modular-maintenance-tracking
plan: 01
subsystem: maintenance-engine
tags: [milestones, tdd, csv, due-soon, urgency-sort, DI]
dependency_graph:
  requires: []
  provides: [getDueSoonThresholds, isDueSoon, saveMilestoneConfig, saveDueSoonThresholds, urgencyScore]
  affects: [app/maintenance/milestones.js, app/maintenance/milestones.test.js]
tech_stack:
  added: []
  patterns: [DI-csvOps, node-test-runner, optional-today-param-for-testability]
key_files:
  modified:
    - app/maintenance/milestones.js
  created:
    - app/maintenance/milestones.test.js
decisions:
  - getDueSoonThresholds accepts optional config param (defaults to state.fleet.milestoneConfig) for test determinism without state mocking
  - isDueSoon accepts optional today param for date-deterministic tests
  - getMilestonesForCategory returns [] for unknown categories instead of DEFAULT_MILESTONES fallback — DEFAULT_MILESTONES kept for buildDefaultConfigCSV seeding only
  - urgencyScore uses numeric bands (overdue:-1M, due-soon:0+, ok:1M+, untracked:9M) for stable sort ordering
  - DI pattern (csvOps = defaultCsvOps) matches established convention from record.js and batch-milestone.js
metrics:
  duration: 3min
  completed_date: "2026-03-30"
  tasks_completed: 2
  files_modified: 2
requirements_satisfied: [MAINT-02, MAINT-04, MAINT-05, MAINT-06, MAINT-08, MAINT-10]
---

# Phase 10 Plan 01: Milestone Engine — Configurable Thresholds, CSV Write, Urgency Sort Summary

**One-liner:** Configurable milestone engine with _config-row thresholds, mileage+time due-soon detection, urgency sort scoring, and DI-pattern CSV write functions — removes DEFAULT_MILESTONES runtime fallback.

## Tasks Completed

| Task | Type | Name | Commit | Files |
|------|------|------|--------|-------|
| 1 | RED | Failing tests for all new milestone engine functions | eb01f65 | app/maintenance/milestones.test.js (+351 lines) |
| 2 | GREEN | Implement getDueSoonThresholds, isDueSoon, urgencyScore, saveMilestoneConfig, saveDueSoonThresholds | bc109ad | app/maintenance/milestones.js (+190 lines, -13 lines) |

## What Was Built

### New Exports

- **getDueSoonThresholds(config?)** — Reads `_config` rows from milestoneConfig state. Returns `{dueSoonMiles: 3000, dueSoonDays: 14}` with fallback defaults. Accepts optional `config` parameter for testability without state mocking.

- **isDueSoon(milestoneStatus, currentMiles, dueSoonMiles, dueSoonDays, today?)** — Returns `true` when a milestone is within the threshold range (not overdue). Checks both mileage remaining and days remaining. Accepts optional `today` YYYY-MM-DD string for test determinism.

- **urgencyScore(milestoneStatus, currentMiles, dueSoonMiles, dueSoonDays)** — Returns numeric sort key: overdue (< 0), due-soon (0–999999), ok (1M+), not-tracked/no-interval (9M). Within overdue/due-soon bands, more urgent sorts lower.

- **saveMilestoneConfig(updatedRows, token, csvOps?)** — Download-merge-write pattern. Preserves `_config` rows from existing CSV, replaces all non-`_config` rows with `updatedRows`. Updates `state.fleet.milestoneConfig` and `milestoneConfigHash` after successful write.

- **saveDueSoonThresholds(miles, days, token, csvOps?)** — Downloads fresh CSV, removes old `due-soon-miles` and `due-soon-days` `_config` rows, inserts new threshold rows, preserves all other rows. Updates state after write.

### Modified Exports

- **getMilestonesForCategory(category)** — Now filters out `_config` rows before category matching. Returns `[]` for unknown categories instead of falling back to DEFAULT_MILESTONES. Empty string input returns `[]`.

### Preserved Exports

All existing exports preserved: `DEFAULT_MILESTONES`, `TIRE_POSITIONS`, `MILESTONES`, `MILESTONE_CONFIG_HEADERS`, `buildDefaultConfigCSV`, `getMilestoneStatus`.

## Test Results

```
29 tests, 0 failures
node --test app/maintenance/milestones.test.js
```

All 6 describe blocks pass:
- getDueSoonThresholds (7 tests)
- isDueSoon (9 tests)
- getMilestonesForCategory (3 tests)
- urgencyScore (6 tests)
- saveMilestoneConfig (2 tests)
- saveDueSoonThresholds (2 tests)

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

1. **getDueSoonThresholds optional config param** — Allows tests to pass mock config arrays directly without needing to mock `state` module. Same pattern as other DI conventions in the codebase.

2. **isDueSoon optional today param** — All date-based tests use a fixed `today = '2026-03-30'` string, making tests deterministic regardless of when they run.

3. **getMilestonesForCategory returns [] instead of DEFAULT_MILESTONES** — DEFAULT_MILESTONES is now only used by `buildDefaultConfigCSV` for seeding the OneDrive CSV. Runtime category lookups that find no CSV rows return empty array, forcing callers to handle the empty state explicitly.

4. **urgencyScore numeric bands** — Uses large numeric bands (1M gap between status levels) so that within-band ordering (e.g., more-overdue-first) never crosses into the next band.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| app/maintenance/milestones.js | FOUND |
| app/maintenance/milestones.test.js | FOUND |
| Commit eb01f65 (RED tests) | FOUND |
| Commit bc109ad (GREEN implementation) | FOUND |
| 29/29 tests passing | CONFIRMED |

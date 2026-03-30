---
phase: 10-modular-maintenance-tracking
plan: 03
subsystem: ui
tags: [dashboard, milestones, urgency-sort, collapse-expand, coming-due-tab, configurable-thresholds]

# Dependency graph
requires:
  - phase: 10-01
    provides: getDueSoonThresholds, isDueSoon, urgencyScore exports from milestones.js
provides:
  - Dashboard collapses OK milestones by default with expand toggle
  - Milestones sorted by urgency within each card
  - Due-soon detection uses configurable thresholds (not hardcoded 500 miles)
  - Time-based due-soon detection via isDueSoon()
  - Coming Due tab for cross-type maintenance planning
  - Gear icon in header linking to #settings
affects: [settings-view, milestone-config]

# Tech tracking
tech-stack:
  added: []
  patterns: [urgency-sort via urgencyScore(), partition-visible-hidden for collapse, event-delegation for expand-milestones inside anchor tags]

key-files:
  created: []
  modified:
    - app/views/dashboard.js

key-decisions:
  - "Status filter dropdown hidden when Coming Due tab is active (tab IS the filter per RESEARCH Pitfall 6)"
  - "DOT Inspection row rendered outside collapse system — always visible per CONTEXT.md"
  - "e.preventDefault() + e.stopPropagation() on expand-milestones click — prevents navigation since expand div is inside card anchor tag"
  - "Coming Due tab count badge shows units with overdue or due-soon status (not milestone count)"
  - "renderMsRow extracted as inner helper function to avoid code duplication between visible/hidden rows"

patterns-established:
  - "Partition pattern: visibleResults (overdue/due-soon) + hiddenResults (ok/not-tracked), render separately with toggle"
  - "Coming Due synthetic tab: allTabs = [...categories, 'Coming Due'], skip filters when active"

requirements-completed: [MAINT-07, MAINT-08, MAINT-09]

# Metrics
duration: 13min
completed: 2026-03-30
---

# Phase 10 Plan 03: Dashboard UX Improvements Summary

**Dashboard cards now collapse OK milestones by default with expand toggle, sort milestones by urgency, use configurable time+mileage due-soon thresholds, and gain a Coming Due tab for cross-type batch maintenance planning**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-30T21:22:54Z
- **Completed:** 2026-03-30T21:36:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Replaced hardcoded 500-mile due-soon check with `getDueSoonThresholds()` + `isDueSoon()` including time-based detection
- Milestones within each card sorted by `urgencyScore()` — overdue first, due-soon second, OK/untracked last
- OK and not-tracked milestones collapsed by default; expand toggle shows hidden count with click to expand/collapse
- DOT Inspection row always visible (outside collapse system)
- Coming Due tab added alongside equipment type tabs, grouping overdue/due-soon milestones by label across all units
- Gear icon added to dashboard header linking to `#settings`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add gear icon, configurable due-soon thresholds, and urgency-sorted collapse/expand cards** - `fc23846` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `app/views/dashboard.js` - Updated with all 7 dashboard UX changes: imports, gear icon, getDueSoonThresholds, urgency sort, collapse/expand, expand event delegation, Coming Due tab

## Decisions Made
- Status filter dropdown hidden when Coming Due tab is active — the tab itself IS the filter (no need for redundant all/overdue/due-soon dropdown)
- DOT Inspection row rendered after the expand section, always visible, per CONTEXT.md requirement
- `e.preventDefault()` + `e.stopPropagation()` critical on expand click — the expand div lives inside a card `<a>` tag, so without this, click would navigate to `#unit`
- Coming Due tab badge shows unique unit count (not milestone count) — consistent with other tab counts
- `renderMsRow` extracted as local helper inside `renderDashboard` to avoid code duplication between visible and hidden rows

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Dashboard UX requirements MAINT-07, MAINT-08, MAINT-09 complete
- Settings view (plan 10-04 or similar) can wire up the gear icon at `#settings`
- `getDueSoonThresholds()` / `saveDueSoonThresholds()` ready for settings page to expose user-configurable values

---
*Phase: 10-modular-maintenance-tracking*
*Completed: 2026-03-30*

## Self-Check: PASSED

- app/views/dashboard.js: FOUND
- 10-03-SUMMARY.md: FOUND
- Task commit fc23846: FOUND in git log

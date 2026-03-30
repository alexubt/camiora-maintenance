# Phase 10: Modular Maintenance Tracking - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/ideas/2026-03-30-modular-maintenance-tracking-system.md)

<domain>
## Phase Boundary

This phase transforms the hardcoded maintenance tracking system into a fully configurable one. The fleet manager can define maintenance schedules per equipment type, set due-soon thresholds, and see dynamic dashboard cards that adapt to any number of milestones. Includes a settings UI, CSV write path for milestone config, collapsible dashboard cards, Coming Due filter, and trailer tire tracking.

</domain>

<decisions>
## Implementation Decisions

### Equipment Types
- Auto-discovered from `Type` column in `units.csv` (currently Truck, Trailer)
- No "create type" UI — new types appear automatically when added to fleet roster
- Each type has its own independent milestone list

### Due Soon Threshold
- Mileage-based: configurable, default 3,000 miles before due
- Time-based: configurable, default 14 days before due
- Currently hardcoded at 500 miles with NO time-based due-soon — both need to be added
- Stored in milestone-config.csv as special `_config` category rows

### Tire Monitor
- Stays as a **separate system** — not part of milestone config
- Tire positions are logged replacement dates, no intervals, no overdue
- Trailer tire tracking needs to be added (same UI as truck tire monitor, trailer axle positions)

### Dashboard Card Rendering
- Show only overdue + due-soon milestones, collapse OK items
- Overdue items sort first, then due-soon, then OK (auto-sorted by system)
- Expand/collapse link shows all milestones when tapped
- DOT Inspection remains as a special built-in row (always visible)

### Milestone Ordering
- System auto-sorts: overdue first → due-soon → OK → not-tracked
- Within each group, sort by urgency (most overdue first, closest to due first)
- No user-configurable display order

### Planning View / Coming Due Filter
- "Coming Due" filter tab on existing dashboard (alongside Trucks / Trailers tabs)
- Shows all units with any milestone due within threshold (3K miles / 14 days)
- Groups by milestone type for batch scheduling visibility
- Not a separate page — reuses existing dashboard infrastructure

### Settings Access
- Gear icon in dashboard header (not a nav tab)
- Opens settings page via `#settings` route
- Back button returns to dashboard (unit detail page pattern, not full nav)

### CSV Format — Due Soon Threshold Storage
- Special rows in milestone-config.csv with `_config` category prefix:
  ```
  _config,due-soon-miles,Due Soon Miles,3000,
  _config,due-soon-days,Due Soon Days,,14
  ```
- Keeps everything in one file, no new infrastructure needed

### DEFAULT_MILESTONES Removal
- Remove `DEFAULT_MILESTONES` as runtime fallback — CSV is single source of truth
- Keep `buildDefaultConfigCSV()` for first-launch seeding only (404 handling)

### Cost Tracking / Analytics
- Deferred to a future "Reports & Maintenance Audit" idea
- Not part of this phase

### Claude's Discretion
- Settings page layout and component structure
- Inline editing UX (modal vs inline form vs accordion)
- Validation rules for milestone intervals
- Toast/feedback patterns for save success/failure
- Offline behavior for config editing (show warning vs queue)

</decisions>

<specifics>
## Specific Ideas

### What Already Exists (from PRD codebase exploration)
- `milestone-config.csv` on OneDrive with headers: `Category, Type, Label, IntervalMiles, IntervalDays`
- `getMilestonesForCategory()` reads from CSV, falls back to `DEFAULT_MILESTONES`
- `getMilestoneStatus()` handles both mileage and time intervals
- `buildDefaultConfigCSV()` seeds defaults on first launch (404 handling)
- CSV read/write/lock infrastructure in `graph/csv.js`
- Router supports adding new views by adding one line to `ROUTES` map

### Files That Need Changes (from PRD)
- **New:** `app/views/settings.js` — Settings page with milestone config CRUD
- **Modify:** `app/maintenance/milestones.js` — saveMilestoneConfig(), remove DEFAULT_MILESTONES fallback
- **Modify:** `app/views/dashboard.js` — collapsible cards, Coming Due filter, gear icon, time-based due-soon, configurable threshold
- **Modify:** `app/views/unit-detail.js` — trailer tire positions in tire monitor
- **Modify:** `app/router.js` — add #settings route
- **Modify:** `sw.js` — add settings.js to cache

</specifics>

<deferred>
## Deferred Ideas

- Cost tracking / analytics (deferred to Reports & Maintenance Audit idea)
- Per-unit milestone overrides (all units of a type share the same schedule)
- Reefer equipment type (removed from scope)
- Tire monitor intervals/overdue (stays as date-log-only system)

</deferred>

---

*Phase: 10-modular-maintenance-tracking*
*Context gathered: 2026-03-30 via PRD Express Path*

# Phase 10: Modular Maintenance Tracking - Research

**Researched:** 2026-03-30
**Domain:** Vanilla JS PWA — settings view, CSV read/write, dashboard UX, milestone config
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Equipment Types**
- Auto-discovered from `Type` column in `units.csv` (currently Truck, Trailer)
- No "create type" UI — new types appear automatically when added to fleet roster
- Each type has its own independent milestone list

**Due Soon Threshold**
- Mileage-based: configurable, default 3,000 miles before due
- Time-based: configurable, default 14 days before due
- Currently hardcoded at 500 miles with NO time-based due-soon — both need to be added
- Stored in milestone-config.csv as special `_config` category rows

**Tire Monitor**
- Stays as a separate system — not part of milestone config
- Tire positions are logged replacement dates, no intervals, no overdue
- Trailer tire tracking needs to be added (same UI as truck tire monitor, trailer axle positions)

**Dashboard Card Rendering**
- Show only overdue + due-soon milestones, collapse OK items
- Overdue items sort first, then due-soon, then OK (auto-sorted by system)
- Expand/collapse link shows all milestones when tapped
- DOT Inspection remains as a special built-in row (always visible)

**Milestone Ordering**
- System auto-sorts: overdue first → due-soon → OK → not-tracked
- Within each group, sort by urgency (most overdue first, closest to due first)
- No user-configurable display order

**Planning View / Coming Due Filter**
- "Coming Due" filter tab on existing dashboard (alongside Trucks / Trailers tabs)
- Shows all units with any milestone due within threshold (3K miles / 14 days)
- Groups by milestone type for batch scheduling visibility
- Not a separate page — reuses existing dashboard infrastructure

**Settings Access**
- Gear icon in dashboard header (not a nav tab)
- Opens settings page via `#settings` route
- Back button returns to dashboard (unit detail page pattern, not full nav)

**CSV Format — Due Soon Threshold Storage**
- Special rows in milestone-config.csv with `_config` category prefix:
  ```
  _config,due-soon-miles,Due Soon Miles,3000,
  _config,due-soon-days,Due Soon Days,,14
  ```
- Keeps everything in one file, no new infrastructure needed

**DEFAULT_MILESTONES Removal**
- Remove `DEFAULT_MILESTONES` as runtime fallback — CSV is single source of truth
- Keep `buildDefaultConfigCSV()` for first-launch seeding only (404 handling)

### Claude's Discretion
- Settings page layout and component structure
- Inline editing UX (modal vs inline form vs accordion)
- Validation rules for milestone intervals
- Toast/feedback patterns for save success/failure
- Offline behavior for config editing (show warning vs queue)

### Deferred Ideas (OUT OF SCOPE)
- Cost tracking / analytics (deferred to Reports & Maintenance Audit idea)
- Per-unit milestone overrides (all units of a type share the same schedule)
- Reefer equipment type (removed from scope)
- Tire monitor intervals/overdue (stays as date-log-only system)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MAINT-01 | Settings page accessible via gear icon on dashboard header, routed at `#settings` | Router pattern already established; one-line ROUTES addition + render import |
| MAINT-02 | Equipment types auto-discovered from `Type` column in `units.csv` | `state.fleet.units` already loaded; `renderDashboard` already discovers categories via Set scan |
| MAINT-03 | Per-type milestone CRUD — add, edit, delete milestones with name, interval type, interval value | `milestoneConfig` rows in state; write path uses `writeCSVWithLock` with `MILESTONE_CONFIG_HEADERS` |
| MAINT-04 | Milestone config persisted to `milestone-config.csv` on OneDrive (read/write, not read-only) | `state.fleet.milestoneConfigPath` and `milestoneConfigHash` already in state; `writeCSVWithLock` pattern established |
| MAINT-05 | Configurable due-soon thresholds — mileage (default 3,000 mi) and time (default 14 days) | `_config` rows in milestone-config.csv; `getMilestonesForCategory` must filter `_config` category out of milestone list |
| MAINT-06 | Time-based due-soon calculation added (currently missing entirely) | `getMilestoneStatus` already computes `nextDueDate`; dashboard code uses hardcoded 500mi check and ignores time — both need updating |
| MAINT-07 | Dashboard cards show only overdue + due-soon milestones by default, with expand/collapse for OK items | Currently renders all rows; need collapse logic + expand link per card |
| MAINT-08 | Milestones auto-sorted by urgency: overdue first, then due-soon, then OK, then not-tracked | Currently no per-card milestone sort; need urgency sort within `msRows` loop |
| MAINT-09 | "Coming Due" filter tab on dashboard alongside Trucks/Trailers tabs | `_activeTab` system and tab rendering already in `renderDashboard`; add special "Coming Due" synthetic tab |
| MAINT-10 | Remove `DEFAULT_MILESTONES` hardcoded fallback — CSV is single source of truth | `getMilestonesForCategory` falls back to `DEFAULT_MILESTONES` when no CSV rows; remove that branch |
| MAINT-11 | Trailer tire positions added to tire monitor on unit detail page | `TIRE_POSITIONS` already has `trailer-1-l/r`, `trailer-2-l/r`; `renderTireMonitor` already handles trailer type with Axle group — confirm coverage is sufficient |
| MAINT-12 | Service worker cache updated with settings view | Pattern established: bump `CACHE` constant, add `'./app/views/settings.js'` to STATIC array |
</phase_requirements>

## Summary

Phase 10 transforms the maintenance milestone system from read-only (CSV-seeded-on-boot, hardcoded fallback) to fully configurable from within the app. The primary work is three areas: a new settings view with milestone CRUD, dashboard UX changes (collapse/expand, time-based due-soon, Coming Due tab, configurable thresholds), and a small trailer tire tracking addition.

The codebase is very well-suited for this phase. All the infrastructure already exists: `state.fleet.milestoneConfig` and `milestoneConfigHash` are in state, `loadMilestoneConfig()` seeds on 404, `writeCSVWithLock` handles optimistic locking, and the router accepts one-line route additions. The dashboard already auto-discovers equipment types from `state.fleet.units`, and the tire monitor already has trailer positions in `TIRE_POSITIONS` with a working `renderTireMonitor` that branches on unit type. The largest change is dashboard.js — the card rendering loop needs milestone sorting + collapse logic + time-based due-soon + Coming Due tab logic.

**Primary recommendation:** Build in four focused plans: (1) `milestones.js` refactor — `saveMilestoneConfig`, `getDueSoonThresholds`, remove DEFAULT_MILESTONES fallback, add `isDueSoon` helper; (2) settings view with milestone CRUD per type; (3) dashboard changes — collapse/expand, time-based due-soon, Coming Due tab, configurable threshold; (4) trailer tire + SW cache + verification.

## Standard Stack

### Core (already in use — no new dependencies)

| Library / Module | Version / Location | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS ES modules | Native browser | All app code | Project constraint — no build step, no npm for app code |
| `app/graph/csv.js` | Existing | `downloadCSV`, `parseCSV`, `serializeCSV`, `writeCSVWithLock` | Established data layer — all CSV CRUD goes through here |
| `app/state.js` | Existing | `state.fleet.milestoneConfig`, `milestoneConfigHash`, `milestoneConfigPath` | Single shared state singleton; already has milestoneConfig slot |
| `app/maintenance/milestones.js` | Existing | Milestone definitions, `getMilestoneStatus`, `getMilestonesForCategory` | All milestone logic lives here; this phase extends it |
| `app/views/dashboard.js` | Existing | Dashboard render, tab system, card rendering | All dashboard changes go here |
| `app/views/unit-detail.js` | Existing | Tire monitor, `TIRE_POSITIONS` import | Trailer tire additions here |
| `app/router.js` | Existing | Hash-based SPA routing | Add `#settings` → one line in `ROUTES` map |
| `node:test` + `node:assert` | Node.js built-in | Unit tests | Project decision 01-01: zero-dependency test runner |

### No New Libraries Needed

This phase is entirely self-contained within the existing stack. No npm packages, no CDN scripts, no new infrastructure.

## Architecture Patterns

### Recommended Project Structure (new + modified files)

```
app/
├── views/
│   └── settings.js          # NEW — settings page (milestone CRUD per type)
├── maintenance/
│   └── milestones.js        # MODIFY — saveMilestoneConfig(), getDueSoonThresholds(), remove DEFAULT fallback
├── views/
│   └── dashboard.js         # MODIFY — collapse/expand, time-based due-soon, Coming Due tab, gear icon
├── views/
│   └── unit-detail.js       # MODIFY — confirm/expand trailer tire positions
├── router.js                 # MODIFY — add #settings route
└── main.js                   # no change needed (loadMilestoneConfig already runs at boot)
sw.js                         # MODIFY — bump CACHE version, add settings.js
```

### Pattern 1: CSV Write with Optimistic Lock

All milestone config writes follow the exact same pattern already used for units, maintenance, and condition CSVs.

```javascript
// From app/maintenance/milestones.js (NEW function)
export async function saveMilestoneConfig(milestoneRows, token, csvOps = defaultCsvOps) {
  const { text, hash } = await csvOps.downloadCSV(state.fleet.milestoneConfigPath, token);
  // merge/replace rows for affected category, keep other categories intact
  const existing = csvOps.parseCSV(text);
  // ...filter out old rows for this category, push new rows, keep _config rows...
  const newText = csvOps.serializeCSV(MILESTONE_CONFIG_HEADERS, updated);
  const result = await csvOps.writeCSVWithLock(state.fleet.milestoneConfigPath, hash, newText, token);
  // update in-memory state
  state.fleet.milestoneConfig = updated;
  state.fleet.milestoneConfigHash = await csvOps.hashText(newText);
  return result;
}
```

**Key insight:** Download-mutate-write is always done fresh (not from stale in-memory copy) to avoid optimistic lock conflicts when multiple tabs/sessions are active.

### Pattern 2: Router Extension

```javascript
// app/router.js — ONE line addition
import { render as renderSettings } from './views/settings.js';

const ROUTES = {
  '#upload':    renderUpload,
  '#unit':      renderUnitDetail,
  '#dashboard': renderDashboard,
  '#settings':  renderSettings,   // ADD THIS
};
```

### Pattern 3: Settings View Structure (Claude's Discretion)

Settings follows the unit-detail page pattern: gear icon navigates to `#settings`, back chevron returns to `#dashboard`. No new navigation infrastructure needed.

Recommended layout (accordion by equipment type — simpler than modal, works well on mobile):

```
[← Dashboard]
Settings

[Truck ▼]
  PM           30,000 mi     [Edit] [Delete]
  Air Filter   100,000 mi    [Edit] [Delete]
  ...
  [+ Add Milestone]

[Trailer ▼]
  PM           30,000 mi     [Edit] [Delete]
  ...
  [+ Add Milestone]

Due Soon Thresholds
  Miles before due: [3000]
  Days before due:  [14]
  [Save Thresholds]
```

Inline form expansion (same pattern as unit-detail edit rows) is preferred over modals for this mobile PWA context.

### Pattern 4: _config Row Parsing

The milestone-config.csv contains two row types. `getMilestonesForCategory` must filter them:

```javascript
// CSV format (already decided):
// _config,due-soon-miles,Due Soon Miles,3000,
// _config,due-soon-days,Due Soon Days,,14

export function getDueSoonThresholds() {
  const rows = state.fleet.milestoneConfig || [];
  const milesRow = rows.find(r => r.Category === '_config' && r.Type === 'due-soon-miles');
  const daysRow  = rows.find(r => r.Category === '_config' && r.Type === 'due-soon-days');
  return {
    dueSoonMiles: milesRow ? Number(milesRow.IntervalMiles) || 3000 : 3000,
    dueSoonDays:  daysRow  ? Number(daysRow.IntervalDays)   || 14   : 14,
  };
}

// getMilestonesForCategory must exclude _config rows:
export function getMilestonesForCategory(category) {
  const csvRows = (state.fleet.milestoneConfig || [])
    .filter(r => (r.Category || '').trim() !== '_config');  // <-- ADD THIS FILTER
  // ...existing logic...
}
```

### Pattern 5: Dashboard Collapse/Expand per Card

The current card renders all milestone rows. The new behavior: show only overdue + due-soon rows by default; add an "expand" link if OK rows exist.

```javascript
// Partition milestone results:
const overdueRows  = msResults.filter(r => r.s.status === 'overdue');
const dueSoonRows  = msResults.filter(r => r.s.dueSoon === true);
const okRows       = msResults.filter(r => r.s.status === 'ok' && !r.s.dueSoon);
const naRows       = msResults.filter(r => r.s.status === 'not-tracked' || r.s.status === 'no-interval');

const collapsed = [...overdueRows, ...dueSoonRows];
const hiddenCount = okRows.length + naRows.length;

// Render collapsed rows + expand toggle if hiddenCount > 0
// Use data-unit-id on expand button; toggle display:none on hidden container
// Expand state does NOT need to persist across re-renders (mobile UX preference)
```

**Implementation note:** The expand/collapse toggle is DOM-only (no re-render). Wire click on `data-action="expand-milestones"` with `data-unit-id` attribute.

### Pattern 6: Coming Due Tab

The tab system uses `_activeTab` module-level variable. "Coming Due" is a synthetic tab that doesn't map to a unit type category.

```javascript
// In renderDashboard, after discovering categories:
const allTabs = [...categories, 'Coming Due'];

// When _activeTab === 'Coming Due':
// Show all units (across all types) that have at least one milestone
// with remaining <= dueSoonMiles OR days remaining <= dueSoonDays
// Group rows by milestone type (not by unit) for batch scheduling view
```

**Coming Due tab renders differently:** Instead of one card per unit, group by milestone label — e.g., "PM (3 units)", "Brake Inspection (1 unit)" with unit IDs listed.

### Pattern 7: Urgency Sort within Card Milestones

After computing all `getMilestoneStatus` results, sort before rendering:

```javascript
function urgencyScore(s, currentMiles, dueSoonMiles, dueSoonDays) {
  if (s.status === 'overdue') {
    // Most overdue = highest urgency (most negative remaining)
    const mileOver = s.nextDueMiles != null ? currentMiles - s.nextDueMiles : 0;
    return -(1000000 + mileOver);
  }
  if (s.dueSoon) {
    const mileRemain = s.nextDueMiles != null ? s.nextDueMiles - currentMiles : Infinity;
    return -(mileRemain);
  }
  if (s.status === 'ok') return 1;
  return 2; // not-tracked / no-interval
}
```

### Anti-Patterns to Avoid

- **Writing from stale in-memory state:** Never serialize `state.fleet.milestoneConfig` directly to CSV without re-downloading first. Always download → mutate → writeCSVWithLock.
- **Storing expand/collapse state across full re-renders:** The expand state should reset on re-render (data reload) — this is fine behavior for this app.
- **Putting `_config` rows through milestone rendering:** Always filter `Category === '_config'` before passing rows to `getMilestonesForCategory` or the settings CRUD UI.
- **Mutating DEFAULT_MILESTONES after removal:** Once removed as runtime fallback, the constant can be kept only for `buildDefaultConfigCSV()` seeding. Don't reintroduce it as a fallback code path.
- **Re-downloading milestone-config.csv on every dashboard render:** The config is loaded once at boot and cached in `state.fleet.milestoneConfig`. Only reload after a settings save.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV optimistic locking | Custom ETag or timestamp check | `writeCSVWithLock` in `graph/csv.js` | Already handles hash-check + PUT; retry logic for conflicts in `appendUnit` pattern |
| State management | Custom event bus / reactive store | `state` singleton + `window.dispatchEvent(new HashChangeEvent('hashchange'))` | Established pattern throughout all views |
| Route transitions | Animation or navigation lib | `window.location.hash = '#settings'` | Router already handles hashchange → view render |
| Toast notifications | Custom notification system | `showToast(container, msg, type)` from unit-detail.js | Already exists and works |
| CSV serialization | Custom CSV writer | `serializeCSV(headers, rows)` from graph/csv.js | Handles column ordering, empty values |
| Type discovery | Hardcoded type list | `state.fleet.units.map(u => u.Type)` dedup | Dashboard already does this with a Set — reuse the exact same pattern in settings.js |

**Key insight:** This codebase has excellent DI (dependency injection) patterns for testing. All new functions in `milestones.js` and `settings.js` that touch CSV should accept `csvOps = defaultCsvOps` parameter — this is the established project convention.

## Common Pitfalls

### Pitfall 1: _config Rows Leaking into Milestone Display

**What goes wrong:** `getMilestonesForCategory('_config')` returns an empty array (no match), but if `_config` rows are not filtered before the settings type-list is built, a `_config` tab appears in the settings UI.
**Why it happens:** `state.fleet.milestoneConfig` contains mixed row types; code that builds "all categories" by scanning unique `Category` values will include `_config`.
**How to avoid:** Any code that discovers types from `milestoneConfig` must filter `r.Category !== '_config'`.
**Warning signs:** A `_config` section appearing in the settings accordion.

### Pitfall 2: Due-Soon Hardcoded at 500 Miles

**What goes wrong:** `dashboard.js` line 188-189 has `if (remaining >= 0 && remaining <= 500)` — this hardcoded 500 will be wrong after the configurable threshold is introduced.
**Why it happens:** It was the original hardcoded value; never wired to `getDueSoonThresholds()`.
**How to avoid:** Replace the hardcoded 500 with `getDueSoonThresholds().dueSoonMiles` when computing `dueSoonCount` and `unitDueSoon` in `renderDashboard`.
**Warning signs:** "Due Soon" summary counter doesn't change when thresholds are modified in settings.

### Pitfall 3: Time-Based Due-Soon Missing from Dashboard

**What goes wrong:** `getMilestoneStatus` computes `nextDueDate` correctly, but `renderDashboard` only checks `s.nextDueMiles` for due-soon logic — it never checks `nextDueDate`. Time-only milestones (e.g., `air-dryer` at 365 days, `batteries` at 730 days) will never show as due-soon on the dashboard.
**Why it happens:** The dashboard due-soon check was written before time-based support was fully wired.
**How to avoid:** In the due-soon check, also compare `s.nextDueDate` against today + threshold days.
**Warning signs:** Air Dryer and Batteries never show as "Due Soon" even when within 14 days of due date.

### Pitfall 4: milestoneConfigHash Stale After Settings Save

**What goes wrong:** After `saveMilestoneConfig` writes a new CSV, `state.fleet.milestoneConfigHash` must be updated. If it's not, the next settings save attempt will fail with `CSV_CONFLICT` because the hash no longer matches.
**Why it happens:** `writeCSVWithLock` returns the driveItem but doesn't auto-update state hashes — that's the caller's responsibility (see how `loadMilestoneConfig` in main.js stores the hash after download).
**How to avoid:** After a successful write in `saveMilestoneConfig`, re-hash the new text and store in `state.fleet.milestoneConfigHash`.
**Warning signs:** Second save attempt after any settings change throws "CSV content has changed since last read".

### Pitfall 5: Expand/Collapse ID Collision

**What goes wrong:** Using `id="expandable-${unitId}"` on the hidden milestone container works fine when unit IDs are unique, but `data-unit-id` on the expand button must also be unique. If two cards share content structure, DOM querySelector can match the wrong card.
**Why it happens:** `container.querySelector('#expandable-...')` works; `document.getElementById` would too — but the pattern used in this codebase is event delegation + `closest('[data-unit-id]')`.
**How to avoid:** Use event delegation on the dashboard container (already the pattern). Wire `data-action="expand-milestones"` + `data-unit-id` on the toggle link, and `id="ms-expand-${unitId}"` on the collapsible div.
**Warning signs:** Clicking expand on one card toggles the wrong card's milestones.

### Pitfall 6: Coming Due Tab Excluded from Status Filter

**What goes wrong:** The status filter dropdown (All / Overdue / Due Soon / OK) in `renderDashboard` filters units by `unitStatusMap`. When `_activeTab === 'Coming Due'`, the units shown are already pre-filtered by due-soon logic — applying the status filter on top makes no sense and may produce empty results.
**Why it happens:** The status filter is applied universally.
**How to avoid:** Skip the status filter when `_activeTab === 'Coming Due'`. The Coming Due tab IS the filter.
**Warning signs:** Coming Due tab shows 0 results even though milestones are due.

### Pitfall 7: Trailer Tire Positions Already Partially Wired

**What goes wrong:** MAINT-11 says "add trailer tire positions" but they already exist in `TIRE_POSITIONS` and `renderTireMonitor` already handles the `isTrailer` branch with `trailer-1-l/r` and `trailer-2-l/r`. The implementation appears complete already.
**Why it happens:** The feature may have been partially implemented in a quick task (Quick Task #1 — maintenance milestones and tire monitor, commit 50babbe).
**How to avoid:** Verify the trailer tire monitor renders correctly in browser for a Trailer unit type before adding any code. If already working, MAINT-11 is a verification-only task.
**Warning signs:** Trailer unit detail page shows tire positions from the truck groupings (steer/drive) instead of the axle groupings.

## Code Examples

### getDueSoonThresholds — new function in milestones.js

```javascript
// Source: direct analysis of state.js + CONTEXT.md _config row format
export function getDueSoonThresholds() {
  const rows = state.fleet.milestoneConfig || [];
  const milesRow = rows.find(r => r.Category === '_config' && r.Type === 'due-soon-miles');
  const daysRow  = rows.find(r => r.Category === '_config' && r.Type === 'due-soon-days');
  return {
    dueSoonMiles: milesRow && milesRow.IntervalMiles ? Number(milesRow.IntervalMiles) : 3000,
    dueSoonDays:  daysRow  && daysRow.IntervalDays   ? Number(daysRow.IntervalDays)   : 14,
  };
}
```

### isDueSoon — new helper in milestones.js

```javascript
// Determines if a milestone result qualifies as "due soon" given thresholds
// Source: analysis of getMilestoneStatus return shape + dashboard logic
export function isDueSoon(milestoneStatus, currentMiles, dueSoonMiles, dueSoonDays) {
  const s = milestoneStatus;
  if (s.status === 'overdue') return false; // overdue, not just due-soon
  if (s.nextDueMiles != null && currentMiles > 0) {
    const remaining = s.nextDueMiles - currentMiles;
    if (remaining >= 0 && remaining <= dueSoonMiles) return true;
  }
  if (s.nextDueDate != null) {
    const today = new Date().toISOString().split('T')[0];
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRemaining = (new Date(s.nextDueDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / msPerDay;
    if (daysRemaining >= 0 && daysRemaining <= dueSoonDays) return true;
  }
  return false;
}
```

### saveMilestoneConfig — new function in milestones.js

```javascript
// Source: established writeCSVWithLock pattern from units.js, record.js
import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock, hashText } from '../graph/csv.js';

const defaultCsvOps = { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock, hashText };

export async function saveMilestoneConfig(updatedRows, token, csvOps = defaultCsvOps) {
  // updatedRows = full replacement for all non-_config rows (caller handles merge)
  const { text, hash } = await csvOps.downloadCSV(state.fleet.milestoneConfigPath, token);
  const existing = csvOps.parseCSV(text);
  // Keep _config rows, replace everything else
  const configRows = existing.filter(r => (r.Category || '').trim() === '_config');
  const merged = [...configRows, ...updatedRows];
  const newText = csvOps.serializeCSV(MILESTONE_CONFIG_HEADERS, merged);
  const result = await csvOps.writeCSVWithLock(state.fleet.milestoneConfigPath, hash, newText, token);
  state.fleet.milestoneConfig = merged;
  state.fleet.milestoneConfigHash = await csvOps.hashText(newText);
  return result;
}

export async function saveDueSoonThresholds(miles, days, token, csvOps = defaultCsvOps) {
  const { text, hash } = await csvOps.downloadCSV(state.fleet.milestoneConfigPath, token);
  const existing = csvOps.parseCSV(text);
  // Remove old _config threshold rows, add new ones
  const nonThreshold = existing.filter(r =>
    !(r.Category === '_config' && (r.Type === 'due-soon-miles' || r.Type === 'due-soon-days'))
  );
  nonThreshold.push({ Category: '_config', Type: 'due-soon-miles', Label: 'Due Soon Miles', IntervalMiles: String(miles), IntervalDays: '' });
  nonThreshold.push({ Category: '_config', Type: 'due-soon-days',  Label: 'Due Soon Days',  IntervalMiles: '', IntervalDays: String(days) });
  const newText = csvOps.serializeCSV(MILESTONE_CONFIG_HEADERS, nonThreshold);
  const result = await csvOps.writeCSVWithLock(state.fleet.milestoneConfigPath, hash, newText, token);
  state.fleet.milestoneConfig = nonThreshold;
  state.fleet.milestoneConfigHash = await csvOps.hashText(newText);
  return result;
}
```

### Service Worker Cache Bump Pattern

```javascript
// sw.js — bump version + add new static file
const CACHE = 'camiora-v52';  // was v51
const STATIC = [
  // ... existing entries ...
  './app/views/settings.js',   // ADD THIS
];
```

### Dashboard — Due-Soon Check Replacement

```javascript
// CURRENT (wrong — hardcoded 500, no time-based):
if (remaining >= 0 && remaining <= 500) { dueSoonCount++; unitDueSoon = true; }

// REPLACEMENT:
const { dueSoonMiles, dueSoonDays } = getDueSoonThresholds();
// ... inside milestone loop:
if (isDueSoon(s, currentMiles, dueSoonMiles, dueSoonDays)) { dueSoonCount++; unitDueSoon = true; }
```

## State of the Art

| Old Approach | Current Approach | Status | Impact |
|--------------|------------------|--------|--------|
| `DEFAULT_MILESTONES` runtime fallback | CSV-only (with buildDefaultConfigCSV seeding) | This phase changes it | Removes split source-of-truth; settings CRUD now fully controls config |
| Hardcoded 500-mile due-soon | Configurable via `_config` rows | This phase adds it | Dashboard accurately reflects user-set thresholds |
| No time-based due-soon on dashboard | `isDueSoon` checks both miles + days | This phase adds it | Air dryer / battery / DOT time milestones now show as due-soon |
| All milestones visible on card | Collapsed by default, expand link | This phase changes it | Cards usable on mobile without scrolling past 8 OK rows |
| No Coming Due view | Synthetic tab across all unit types | This phase adds it | Fleet manager can plan batch maintenance visits |

**Deprecated after this phase:**
- `DEFAULT_MILESTONES` object as runtime fallback path — replaced by CSV-is-truth
- Hardcoded `500` mile due-soon threshold in `renderDashboard`

## Open Questions

1. **Trailer tire position completeness**
   - What we know: `TIRE_POSITIONS` has `trailer-1-l/r` and `trailer-2-l/r` (4 positions); `renderTireMonitor` renders these under "Axle" group for trailer/reefer types; this was added in Quick Task #1 (commit 50babbe)
   - What's unclear: Whether the current 4 positions (2 axles × 2 sides) is sufficient for the trailers in the fleet, or if a 3-axle trailer needs 6 positions
   - Recommendation: Verify in browser first. If 4 positions cover actual fleet trailers, MAINT-11 requires no code change — just a verification step.

2. **Coming Due tab — grouping format**
   - What we know: CONTEXT.md says "groups by milestone type for batch scheduling visibility"
   - What's unclear: Exact rendering format — does "Oil Change (3 units)" show unit IDs inline? Links to unit detail?
   - Recommendation: Use simple list: milestone label as section header, unit IDs as links to `#unit?id=...`. Matches existing link pattern from dashboard cards.

3. **Settings save behavior when offline**
   - What we know: CONTEXT.md marks offline behavior as "Claude's Discretion — show warning vs queue"
   - What's unclear: Whether to attempt write and show error, or detect offline state proactively
   - Recommendation: Attempt write; catch network TypeError → show toast "Settings saved locally, will sync when online" without queuing (milestone config is not critical-path like invoice uploads; user can re-save when online). Keep it simple.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | none — run via `node --test` |
| Quick run command | `node --test app/maintenance/milestones.test.js` |
| Full suite command | `node --test app/**/*.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAINT-01 | `#settings` route renders settings view | smoke | manual browser verify | ❌ Wave 0 |
| MAINT-02 | Types auto-discovered from units in state | unit | `node --test app/maintenance/milestones.test.js` | ❌ Wave 0 |
| MAINT-03 | Milestone CRUD modifies correct rows | unit | `node --test app/maintenance/milestones.test.js` | ❌ Wave 0 |
| MAINT-04 | `saveMilestoneConfig` writes CSV and updates state hash | unit | `node --test app/maintenance/milestones.test.js` | ❌ Wave 0 |
| MAINT-05 | `getDueSoonThresholds` reads `_config` rows with fallback defaults | unit | `node --test app/maintenance/milestones.test.js` | ❌ Wave 0 |
| MAINT-06 | `isDueSoon` returns true for time-based milestones within threshold | unit | `node --test app/maintenance/milestones.test.js` | ❌ Wave 0 |
| MAINT-07 | Card collapse hides OK rows; expand shows them | smoke | manual browser verify | ❌ manual-only |
| MAINT-08 | Urgency sort: overdue before due-soon before ok | unit | `node --test app/maintenance/milestones.test.js` | ❌ Wave 0 |
| MAINT-09 | Coming Due tab shows units with milestones within threshold | smoke | manual browser verify | ❌ manual-only |
| MAINT-10 | `getMilestonesForCategory` returns [] (not DEFAULT) when CSV empty | unit | `node --test app/maintenance/milestones.test.js` | ❌ Wave 0 |
| MAINT-11 | Trailer tire monitor renders axle positions | smoke | manual browser verify | ❌ manual-only |
| MAINT-12 | SW cache includes settings.js | smoke | manual browser verify | ❌ manual-only |

### Sampling Rate

- **Per task commit:** `node --test app/maintenance/milestones.test.js`
- **Per wave merge:** `node --test app/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `app/maintenance/milestones.test.js` — covers MAINT-02, MAINT-03, MAINT-04, MAINT-05, MAINT-06, MAINT-08, MAINT-10 (new pure/DI functions need test coverage before implementation)

*(Existing test files `app/views/unit-detail.test.js`, `app/graph/csv.test.js`, etc. cover their respective modules. No new test file needed for dashboard.js or unit-detail.js changes — those changes are rendering-only and verified in browser.)*

## Sources

### Primary (HIGH confidence)

- Direct codebase analysis — `app/maintenance/milestones.js` (full read, 2026-03-30)
- Direct codebase analysis — `app/views/dashboard.js` (full read, 2026-03-30)
- Direct codebase analysis — `app/views/unit-detail.js` (full read, 2026-03-30)
- Direct codebase analysis — `app/graph/csv.js` (full read, 2026-03-30)
- Direct codebase analysis — `app/router.js` (full read, 2026-03-30)
- Direct codebase analysis — `app/state.js` (full read, 2026-03-30)
- Direct codebase analysis — `app/main.js` (full read, 2026-03-30)
- Direct codebase analysis — `app/fleet/units.js` (full read, 2026-03-30)
- Direct codebase analysis — `sw.js` (full read, 2026-03-30)
- `.planning/phases/10-modular-maintenance-tracking/10-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)

- `.planning/REQUIREMENTS.md` — MAINT-01 through MAINT-12 requirement definitions
- `.planning/STATE.md` — accumulated project decisions and patterns
- Existing test files — confirmed `node:test` + `node:assert` test framework pattern

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire stack is existing project code; nothing external to verify
- Architecture patterns: HIGH — all patterns derived directly from reading the actual source files
- Pitfalls: HIGH — identified by reading the exact lines that contain hardcoded values (line 188-189 of dashboard.js) and tracing the data flow through state
- Trailer tire question: MEDIUM — Quick Task #1 added these but the exact completeness of axle coverage for the real fleet is unknown

**Research date:** 2026-03-30
**Valid until:** 2026-05-30 (stable — no external dependencies; only valid while codebase files remain unchanged)

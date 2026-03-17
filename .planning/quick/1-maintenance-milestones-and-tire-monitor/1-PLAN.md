---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - app/views/unit-detail.js
  - app/maintenance/milestones.js
autonomous: true
requirements: [MAINT-MILESTONES, TIRE-MONITOR]
must_haves:
  truths:
    - "Unit detail page shows mileage-based maintenance milestones with last done, interval, next due, and overdue flag"
    - "Overdue milestones are visually flagged red when currentMiles >= next due mileage"
    - "User can record a milestone as done at current mileage"
    - "Unit detail page shows tire position monitor with last replacement date per position"
    - "User can edit tire replacement dates per position"
    - "Notable Mentions free-text field is visible and editable"
  artifacts:
    - path: "app/maintenance/milestones.js"
      provides: "Milestone definitions, tire position constants, pure calculation helpers"
    - path: "app/views/unit-detail.js"
      provides: "Milestones section, tire monitor section rendered on unit detail page"
  key_links:
    - from: "app/views/unit-detail.js"
      to: "app/maintenance/milestones.js"
      via: "import { MILESTONES, TIRE_POSITIONS, getMilestoneStatus } from milestones.js"
    - from: "app/views/unit-detail.js"
      to: "app/graph/csv.js"
      via: "existing CSV read/write for maintenance.csv persistence"
---

<objective>
Add maintenance milestones tracking and tire position monitor sections to the unit detail page.

Purpose: Fleet operators need to track interval-based mileage milestones (PM every 30K, DPF every 250K, etc.) and tire replacement history by position — currently only generic PM schedule items exist.

Output: Two new sections on the unit detail page between Condition and PM Schedule, backed by the existing maintenance.csv data layer.
</objective>

<execution_context>
@C:/Users/FleetManager/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/FleetManager/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@app/views/unit-detail.js
@app/maintenance/schedule.js
@app/state.js
@app/graph/csv.js

<interfaces>
From app/maintenance/schedule.js:
```javascript
export function getDueDate(record);   // { LastDoneDate, IntervalDays } -> YYYY-MM-DD | null
export function getDueMiles(record);  // { LastDoneMiles, IntervalMiles } -> number | null
export function isOverdue(record, todayStr, currentMiles); // -> boolean
```

From app/views/unit-detail.js:
```javascript
// Existing constants and patterns:
const MAINTENANCE_HEADERS = ['MaintId', 'UnitId', 'Type', 'IntervalDays', 'IntervalMiles', 'LastDoneDate', 'LastDoneMiles', 'Notes'];
const CONDITION_HEADERS = ['UnitId', 'CurrentMiles', 'DotExpiry', 'TireNotes', 'LastUpdated'];

// Key data available in renderUnitPage:
// - data.maintenance: array of maintenance records for this unit
// - data.condition: { CurrentMiles, DotExpiry, TireNotes, LastUpdated } or null
// - currentMiles: number (from condition.CurrentMiles)

// Existing helpers: escapeHtml(), statusBadge(status, label), showToast()
// Existing write functions: appendMaintenanceRecord(), markDoneToday(), saveConditionUpdate()
```

From app/graph/csv.js:
```javascript
export async function downloadCSV(remotePath, token);
export function parseCSV(text);
export function serializeCSV(headers, rows);
export async function writeCSVWithLock(remotePath, originalHash, newCSVText, token);
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create milestones module and add milestones section to unit detail</name>
  <files>app/maintenance/milestones.js, app/views/unit-detail.js</files>
  <action>
**1. Create `app/maintenance/milestones.js`** — pure module with constants and helpers:

```javascript
// Milestone definitions — each has a type key and interval in miles
export const MILESTONES = [
  { type: 'PM', intervalMiles: 30000, label: 'PM' },
  { type: 'engine-air-filter', intervalMiles: 100000, label: 'Engine Air Filter' },
  { type: 'dpf-cleaning', intervalMiles: 250000, label: 'DPF Cleaning' },
  { type: 'transmission-oil', intervalMiles: 250000, label: 'Transmission Oil' },
  { type: 'differential-oil', intervalMiles: 250000, label: 'Differential Oil' },
  { type: 'air-dryer', intervalMiles: null, label: 'Air Dryer' },  // interval not set yet
  { type: 'belts-tensioners', intervalMiles: 250000, label: 'Belts and Tensioners' },
];

// Standard truck tire positions
export const TIRE_POSITIONS = [
  { key: 'steer-l', label: 'Steer L' },
  { key: 'steer-r', label: 'Steer R' },
  { key: 'drive-outer-l', label: 'Drive Outer L' },
  { key: 'drive-outer-r', label: 'Drive Outer R' },
  { key: 'drive-inner-l', label: 'Drive Inner L' },
  { key: 'drive-inner-r', label: 'Drive Inner R' },
  { key: 'trailer-1-l', label: 'Trailer 1 L' },
  { key: 'trailer-1-r', label: 'Trailer 1 R' },
  { key: 'trailer-2-l', label: 'Trailer 2 L' },
  { key: 'trailer-2-r', label: 'Trailer 2 R' },
];
```

Add `getMilestoneStatus(milestone, maintenanceRecords, currentMiles)`:
- Find the maintenance record matching this milestone type (filter `data.maintenance` by `Type === milestone.type`)
- If no record exists: return `{ lastDoneMiles: null, nextDueMiles: null, overdue: false, status: 'not-tracked' }`
- If record exists: `lastDoneMiles = Number(record.LastDoneMiles)`, `nextDueMiles = lastDoneMiles + milestone.intervalMiles`
- If `milestone.intervalMiles === null`: return status `'no-interval'` (Air Dryer case)
- `overdue = currentMiles >= nextDueMiles`
- Return `{ lastDoneMiles, nextDueMiles, overdue, status: overdue ? 'overdue' : 'ok', record }`

**2. Modify `app/views/unit-detail.js`** — add milestones section to `renderUnitPage()`:

Add import at top: `import { MILESTONES, TIRE_POSITIONS, getMilestoneStatus } from '../maintenance/milestones.js';`

In `renderUnitPage()`, insert a **Maintenance Milestones** section AFTER the Condition section and BEFORE the PM Schedule section. The section should:

- Display a table with columns: Milestone | Last Done (miles) | Interval | Next Due (miles) | Status | Action
- For each item in MILESTONES, call `getMilestoneStatus(milestone, data.maintenance, currentMiles)`
- Show lastDoneMiles or "---" if not tracked
- Show interval as "30,000 mi" formatted with commas (use `toLocaleString()`)
- Show nextDueMiles formatted or "---"
- Status column: use existing `statusBadge('overdue', 'Overdue')` for overdue, `statusBadge('ok', 'OK')` for ok, `statusBadge('unknown', 'N/A')` for not-tracked or no-interval
- Action column: "Done" button with `data-action="milestone-done" data-milestone-type="{type}"` — records milestone as done at current mileage

- Below the table, add a "Notable Mentions" subsection:
  - Display the existing `data.condition?.TireNotes` field as "Notable Mentions" (repurposing the TireNotes field which is already in condition.csv)
  - Add an inline edit button that shows a textarea for editing
  - Save via the existing `saveConditionUpdate()` function with `{ TireNotes: value }`

Add event handler for `milestone-done` action in the click delegation:
- Get `data-milestone-type` from button
- Find existing maintenance record for that type, or create new one
- If record exists: call `markDoneToday(record.MaintId, currentMiles, ...)` (reuse existing function)
- If no record exists: call `appendMaintenanceRecord()` with `{ MaintId: Date.now().toString(36), UnitId: unitId, Type: milestoneType, IntervalDays: '', IntervalMiles: String(milestone.intervalMiles || ''), LastDoneDate: today, LastDoneMiles: String(currentMiles), Notes: '' }`
- Re-render page after save

Add event handlers for notable mentions edit/save:
- `edit-notable`: toggle visibility of a textarea form
- `save-notable`: call `saveConditionUpdate(unitId, { TireNotes: textareaValue }, ...)` and re-render

Style the milestones table consistently with the existing PM Schedule and Invoice History tables (same font-size:13px, same padding, same border patterns).
  </action>
  <verify>
    <automated>node -e "import('./app/maintenance/milestones.js').then(m => { const s = m.getMilestoneStatus({type:'PM',intervalMiles:30000}, [{Type:'PM',LastDoneMiles:'120000',MaintId:'x'}], 155000); console.log(JSON.stringify(s)); console.assert(s.overdue === true, 'should be overdue'); console.assert(s.nextDueMiles === 150000, 'next due 150k'); console.log('milestones module OK'); })"</automated>
  </verify>
  <done>
    - Milestones module exports MILESTONES array, TIRE_POSITIONS array, and getMilestoneStatus function
    - Unit detail page shows "Maintenance Milestones" section with all 7 milestone types in a table
    - Overdue milestones show red "Overdue" badge when currentMiles >= nextDueMiles
    - "Done" button records milestone completion at current mileage via maintenance.csv
    - Notable Mentions field visible and editable below milestones table
  </done>
</task>

<task type="auto">
  <name>Task 2: Add tire position monitor section to unit detail</name>
  <files>app/views/unit-detail.js</files>
  <action>
**Tire data storage approach:** Use the existing maintenance.csv with a convention: tire replacement records have `Type` = `tire-{position-key}` (e.g., `tire-steer-l`, `tire-drive-outer-r`). The `LastDoneDate` field stores the replacement date. This avoids creating a new CSV file and leverages the existing data layer.

In `renderUnitPage()`, insert a **Tire Monitor** section AFTER the Maintenance Milestones section and BEFORE the PM Schedule section:

**Rendering the tire monitor:**
- Create a helper function `renderTireMonitor(maintenance, unitId)` in unit-detail.js
- For each position in `TIRE_POSITIONS` (imported from milestones.js), find the maintenance record where `Type === 'tire-' + position.key`
- Display as a responsive 2-column grid (on mobile 1 column) of cards, each showing:
  - Position label (e.g., "Steer L")
  - Last replaced date or "Not recorded"
  - A small "Update" button
- Group visually: Steer (2), Drive Outer (2), Drive Inner (2), Trailer (4) with subtle group labels
- Use the same card styling as the Condition section (background:var(--bg-2), border-radius:12px, padding)

**Tire update interaction:**
- "Update" button: `data-action="update-tire" data-tire-pos="{position.key}"`
- On click, show a date input inline (or a small modal-like overlay) to pick the replacement date
- On save: find existing `tire-{pos}` record in maintenance.csv
  - If exists: update `LastDoneDate` via a similar pattern to `markDoneToday` but setting a specific date
  - If not exists: `appendMaintenanceRecord()` with `{ Type: 'tire-' + pos, IntervalDays: '', IntervalMiles: '', LastDoneDate: selectedDate, LastDoneMiles: '', Notes: '' }`
- Re-render after save

**Tire update save function:**
Add `updateTireDate(tireType, dateStr, unitId, token, maintenancePath, csvOps)` near the other action handlers. This function:
- Downloads maintenance.csv
- Finds row where `UnitId === unitId && Type === tireType`
- If found: updates `LastDoneDate = dateStr`
- If not found: pushes new row with `MaintId: Date.now().toString(36), UnitId, Type: tireType, LastDoneDate: dateStr`
- Serializes and writes back with lock

**Event delegation additions in the click handler:**
- `update-tire`: show inline date picker for that position
- `save-tire-date`: read date input value, call `updateTireDate()`, re-render
- `cancel-tire-date`: hide the inline date picker

The inline date picker should appear directly below the tire card that was clicked, showing:
```html
<div>
  <input type="date" id="tireDateInput" value="{today}">
  <button data-action="save-tire-date" data-tire-pos="{pos}">Save</button>
  <button data-action="cancel-tire-date">Cancel</button>
</div>
```

Style consistently with other edit forms on the page (same input styling, same button colors).
  </action>
  <verify>
    <automated>node -e "import('./app/maintenance/milestones.js').then(m => { console.assert(m.TIRE_POSITIONS.length === 10, '10 tire positions'); console.assert(m.TIRE_POSITIONS[0].key === 'steer-l', 'first is steer-l'); console.log('tire positions OK'); })"</automated>
  </verify>
  <done>
    - Tire Monitor section visible on unit detail page showing all 10 tire positions
    - Each position shows last replacement date from maintenance.csv records with Type "tire-{pos}"
    - "Update" button per position opens inline date picker
    - Saving a tire date creates or updates the maintenance record and re-renders
    - Layout is responsive: 2 columns on wider screens, 1 column on mobile
  </done>
</task>

</tasks>

<verification>
1. Navigate to #unit?id={any-unit-id} — page loads without JS errors
2. Maintenance Milestones section visible with 7 milestone rows
3. Milestones with existing maintenance records show last done mileage and computed next due
4. Overdue milestones display red badge
5. "Done" button updates milestone and page re-renders
6. Notable Mentions field shows current value and is editable
7. Tire Monitor section visible with 10 tire positions
8. Tire positions with recorded replacement dates display those dates
9. "Update" button shows date picker, saving persists to maintenance.csv
</verification>

<success_criteria>
Unit detail page has two new sections (Maintenance Milestones and Tire Monitor) fully functional with read/write to existing CSV data layer. No new CSV files needed. All milestone types from requirements represented. All 10 tire positions shown.
</success_criteria>

<output>
After completion, create `.planning/quick/1-maintenance-milestones-and-tire-monitor/1-SUMMARY.md`
</output>

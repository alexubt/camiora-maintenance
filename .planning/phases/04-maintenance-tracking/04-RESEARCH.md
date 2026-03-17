# Phase 4: Maintenance Tracking - Research

**Researched:** 2026-03-17
**Domain:** Per-unit detail view, maintenance CSV schema, overdue date calculation, condition tracking, hash router extension, vanilla JS form patterns
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FLEET-02 | Per-unit invoice history (date, vendor, cost, type — linked to PDFs) | `invoices.csv` already written in Phase 3; filter by `UnitId`, render as table with `PdfPath` links |
| FLEET-03 | Scheduled maintenance tracking with intervals and due dates | New `maintenance.csv` with per-unit PM records; `DueDate` derived from `LastDone + Interval` at write time or computed at read time |
| FLEET-04 | Overdue maintenance alerts | Client-side: `today > DueDate` comparison at render time; visual flag in unit detail and bubbles up to dashboard in Phase 5 |
| FLEET-05 | Unit condition tracking (mileage/hours, DOT inspection status, tire data) | New `condition.csv` (or columns in units.csv); one row per unit with current mileage, DOT expiry, and tire notes |
| FLEET-06 | Unit detail page showing full history and condition | New `app/views/unit-detail.js` view; router handles `#unit?id=TR-042`; aggregates invoices + maintenance + condition for a single unit |
</phase_requirements>

---

## Summary

Phase 4 is primarily a read-heavy display phase. Three data sources converge on the unit detail page: `invoices.csv` (written in Phase 3), a new `maintenance.csv` (PM schedule per unit), and a new `condition.csv` (mileage, DOT expiry, tires per unit). All date and interval logic is computed client-side at render time — no server required.

The most important decision in this phase is the CSV schema for `maintenance.csv` and `condition.csv`. These schemas affect every downstream phase: the dashboard (Phase 5) reads these same files. Locking the schemas now prevents migration work later.

The second key decision is the routing pattern for the unit detail page. The existing hash router (`app/router.js`) handles static routes (`#upload`). It needs to be extended to handle parameterized routes (`#unit?id=TR-042`). This is a small, surgical change to the router — not an architectural rewrite.

The third decision is where condition updates (mileage entry, DOT date entry) live: inline on the unit detail page via edit forms, or as a separate view. Research confirms that inline edit-in-place forms are the standard pattern for mobile-first tools and fit the existing view structure.

**Primary recommendation:** Add `maintenance.csv` and `condition.csv` to `Fleet Maintenance/data/`. Extend the router for query-param routes. Build `app/views/unit-detail.js` that loads all three CSV sources, computes overdue status client-side, and renders history + schedule + condition in a single scrollable view. Edit forms for condition updates reuse `writeCSVWithLock` from `csv.js` exactly as Phase 3 did for invoices.

---

## Standard Stack

### Core (all already in use — no new dependencies)

| Library / API | Version | Purpose | Status |
|---------------|---------|---------|--------|
| `app/graph/csv.js` | Phase 1 | `downloadCSV`, `parseCSV`, `serializeCSV`, `writeCSVWithLock` | Already built and tested |
| `app/graph/files.js` | Phase 1 | `ensureFolder`, `uploadFile` | Already built |
| `app/state.js` | Phase 1 | Shared singleton; needs new fleet fields for maintenance/condition | Extend in this phase |
| `app/storage/cache.js` | Phase 1 | IndexedDB; pattern for caching any CSV data | Already built |
| `app/router.js` | Phase 1 | Hash-based SPA routing; needs query-param extension | Extend in this phase |
| Microsoft Graph API v1.0 | n/a | OneDrive CSV download/upload; same endpoints used in Phase 3 | Already wired |
| node:test | built-in | Zero-dependency test runner (Node.js) | Already used in all prior phases |

### What NOT to add

- No date libraries (moment.js, date-fns, Temporal polyfill) — `new Date(dateString)` and date arithmetic with milliseconds is sufficient for due-date calculations
- No charting libraries — Phase 4 is list/table display only; charts are explicitly out of scope per FEATURES.md
- No virtual DOM or component framework — vanilla JS template literals with `innerHTML` are the established pattern
- No CSV quoting library — values written to maintenance.csv and condition.csv must avoid commas in free-text fields (same constraint as invoices.csv); input sanitization handles this without a library
- No UUID library — `Date.now().toString(36)` is sufficient for `MaintId` and `ConditionId`

### Installation

None required. All dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure (additions for Phase 4)

```
app/
├── graph/
│   └── csv.js           (existing — unchanged)
├── views/
│   ├── upload.js         (existing — unchanged)
│   └── unit-detail.js    (NEW — per-unit history, condition, PM schedule)
├── maintenance/
│   ├── schedule.js       (NEW — pure functions: isDue, isOverdue, computeDueDate)
│   └── schedule.test.js  (NEW — unit tests for pure functions)
├── router.js             (extend for query-param routes)
├── state.js              (extend state.fleet with maintenance/condition paths)
└── main.js               (extend loadFleetData to include maintenance + condition)
```

### OneDrive Folder Layout (extends Phase 3 locked structure)

```
Fleet Maintenance/
  TR-042/
    Invoices/
      TR-042_2026-03-16_oil-change.pdf
  TL-017/
    Invoices/
  data/
    units.csv             (existing)
    invoices.csv          (existing — Phase 3)
    maintenance.csv       (NEW — Phase 4)
    condition.csv         (NEW — Phase 4)
```

### Pattern 1: maintenance.csv Schema

**Path in state:** `Fleet Maintenance/data/maintenance.csv`

**Columns (lock now for Phase 5 compatibility):**

```
MaintId,UnitId,Type,IntervalDays,IntervalMiles,LastDoneDate,LastDoneMiles,Notes
```

| Column | Format | Example | Notes |
|--------|--------|---------|-------|
| `MaintId` | `{timestamp_base36}` | `lxk4f2a` | `Date.now().toString(36)` |
| `UnitId` | Unit ID from roster | `TR-042` | FK to units.csv |
| `Type` | Service type slug | `oil-change` | Matches invoice Type values |
| `IntervalDays` | Integer or empty | `365` | Empty = not time-based |
| `IntervalMiles` | Integer or empty | `10000` | Empty = not mileage-based |
| `LastDoneDate` | `YYYY-MM-DD` or empty | `2025-09-01` | Date maintenance was last performed |
| `LastDoneMiles` | Integer or empty | `145200` | Odometer at last service |
| `Notes` | Free text (no commas) | `Synthetic oil` | Optional; no commas allowed |

**DueDate calculation (client-side at render time):**

```javascript
// Source: app/maintenance/schedule.js — pure functions
function computeDueDateByTime(lastDoneDate, intervalDays) {
  if (!lastDoneDate || !intervalDays) return null;
  const last = new Date(lastDoneDate + 'T00:00:00');
  last.setDate(last.getDate() + Number(intervalDays));
  return last.toISOString().split('T')[0]; // YYYY-MM-DD
}

function computeDueMileage(lastDoneMiles, intervalMiles) {
  if (!lastDoneMiles || !intervalMiles) return null;
  return Number(lastDoneMiles) + Number(intervalMiles);
}

function isOverdue(record, todayStr, currentMiles) {
  const today = new Date(todayStr + 'T00:00:00');
  if (record.IntervalDays && record.LastDoneDate) {
    const dueDate = new Date(computeDueDateByTime(record.LastDoneDate, record.IntervalDays) + 'T00:00:00');
    if (today > dueDate) return true;
  }
  if (record.IntervalMiles && record.LastDoneMiles && currentMiles) {
    const dueMiles = computeDueMileage(record.LastDoneMiles, record.IntervalMiles);
    if (Number(currentMiles) >= dueMiles) return true;
  }
  return false;
}
```

### Pattern 2: condition.csv Schema

**Path in state:** `Fleet Maintenance/data/condition.csv`

**Columns:**

```
UnitId,CurrentMiles,DotExpiry,TireNotes,LastUpdated
```

| Column | Format | Example | Notes |
|--------|--------|---------|-------|
| `UnitId` | Unit ID (PK) | `TR-042` | One row per unit; use UnitId as the logical PK |
| `CurrentMiles` | Integer or empty | `152300` | Current odometer reading |
| `DotExpiry` | `YYYY-MM-DD` or empty | `2026-08-15` | Date DOT inspection expires (annual) |
| `TireNotes` | Free text (no commas) | `Replaced front axle` | Optional short note; no commas allowed |
| `LastUpdated` | `YYYY-MM-DD` | `2026-03-17` | Set to today on every edit |

**One row per unit.** When updating condition, the pattern is: download → parse → find row by UnitId → mutate → serialize → `writeCSVWithLock`. This is a row-update, not an append — unlike invoices.csv which only appends. The logic is:

```javascript
// app/views/unit-detail.js — updateCondition pattern
async function saveConditionUpdate(unitId, updates, token, conditionPath) {
  const { text, hash } = await downloadCSV(conditionPath, token);
  const rows = parseCSV(text) || [];
  const idx = rows.findIndex(r => r.UnitId === unitId);
  if (idx >= 0) {
    Object.assign(rows[idx], updates, { LastUpdated: todayStr() });
  } else {
    rows.push({ UnitId: unitId, ...updates, LastUpdated: todayStr() });
  }
  const newText = serializeCSV(CONDITION_HEADERS, rows);
  return writeCSVWithLock(conditionPath, hash, newText, token);
}
```

### Pattern 3: Router Extension for Parameterized Routes

The current router in `app/router.js` maps static hash keys to render functions. It must be extended to handle `#unit?id=TR-042`.

```javascript
// Extended router pattern — app/router.js
import { render as renderUpload } from './views/upload.js';
import { render as renderUnitDetail } from './views/unit-detail.js';

const ROUTES = {
  '#upload':  renderUpload,
  '#unit':    renderUnitDetail,  // query params parsed inside render()
};

export function initRouter(container) {
  const go = () => {
    const hash = window.location.hash || '#upload';
    const key  = hash.split('?')[0];
    const fn   = ROUTES[key] || renderUpload;
    // Parse query params and pass to render
    const params = Object.fromEntries(
      new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '')
    );
    container.innerHTML = '';
    fn(container, params);
  };
  window.addEventListener('hashchange', go);
  go();
}
```

`renderUnitDetail(container, { id: 'TR-042' })` reads `params.id` to know which unit to display.

All existing render functions must accept an optional second `params` argument (ignored by upload.js since it doesn't need it). This is a backwards-compatible change — existing callers pass nothing, new unit-detail view reads from params.

### Pattern 4: Unit Detail View Structure

```javascript
// app/views/unit-detail.js — skeletal structure
export async function render(container, params = {}) {
  const unitId = params.id;
  if (!unitId) { /* redirect to #upload */ return; }

  // Render loading skeleton immediately
  container.innerHTML = loadingShell(unitId);

  // Load all three data sources in parallel
  const [invoices, maintenance, condition] = await Promise.all([
    loadInvoicesForUnit(unitId),
    loadMaintenanceForUnit(unitId),
    loadConditionForUnit(unitId),
  ]);

  // Compute overdue flags at render time
  const today = new Date().toISOString().split('T')[0];
  const currentMiles = condition?.CurrentMiles || '';
  const scheduleWithStatus = maintenance.map(m => ({
    ...m,
    overdue: isOverdue(m, today, currentMiles),
    dueDate: computeDueDateByTime(m.LastDoneDate, m.IntervalDays),
    dueMiles: computeDueMileage(m.LastDoneMiles, m.IntervalMiles),
  }));

  container.innerHTML = detailShell(unitId, invoices, scheduleWithStatus, condition);
  attachEditListeners(container, unitId, condition);
}
```

### Pattern 5: state.js Extensions

```javascript
// app/state.js additions for Phase 4
export const state = {
  // ... existing fields ...
  fleet: {
    // ... existing fields (units, invoices) ...
    maintenance:       [],
    maintenancePath:   'Fleet Maintenance/data/maintenance.csv',
    maintenanceHash:   null,
    condition:         [],
    conditionPath:     'Fleet Maintenance/data/condition.csv',
    conditionHash:     null,
  },
  activeUnitId: null,  // already exists; set before navigating to #unit
};
```

### Pattern 6: Navigation to Unit Detail

Navigation from any view to a unit detail page follows the hash-link pattern:

```javascript
// Link in any view (upload.js unit dropdown, future dashboard cards)
`<a href="#unit?id=${encodeURIComponent(unitId)}" class="unit-link">${unitId}</a>`
```

Back navigation uses `history.back()` or a hardcoded `href="#upload"` link at the top of the unit detail view.

### Anti-Patterns to Avoid

- **Storing DueDate in the CSV** — computing it at render time from `LastDoneDate + IntervalDays` is simpler, avoids stale data, and lets the interval be changed without migrating existing records. Do not write a derived `DueDate` column.
- **One CSV row per maintenance event** — maintenance.csv holds the *current schedule* (one row per unit per PM type), not a history log. History comes from invoices.csv (filtered by Type match). Mixing these concerns creates duplication and conflicting "last done" sources.
- **Loading all CSV files on every route change** — load on demand when navigating to `#unit`, cache in `state.fleet.*`, and re-use cached data unless explicitly refreshed. Do not download all three CSVs on every `hashchange`.
- **Using innerHTML directly from CSV values without sanitization** — user-entered values like `TireNotes` or `Notes` must be HTML-escaped before injection into `innerHTML`. Use a simple `escapeHtml()` utility; do not use `innerHTML` with raw CSV values.
- **Blocking navigation on CSV load failure** — if `maintenance.csv` or `condition.csv` returns 404 (file not yet created), treat it as empty data and render the page with zero records. The PM schedule section shows "No schedule configured yet" rather than an error.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optimistic CSV locking for condition update | Custom mutex or retry logic | `writeCSVWithLock` in csv.js | Already built, tested, handles hash conflicts |
| CSV parse/serialize for maintenance.csv | Custom string splitting | `parseCSV` / `serializeCSV` in csv.js | Already tested; column order handled by header array |
| OneDrive CSV download | Custom fetch wrapper | `downloadCSV` in csv.js | Handles CRLF normalization, 404 as null, auth header |
| Date arithmetic | date-fns / moment.js | Native `new Date()` + `setDate()` + `getTime()` | Sufficient for add-days and before/after comparison at this scale |
| HTML escaping | DOMPurify or sanitize-html | One-liner `escapeHtml()` pure function | No library needed for simple text escaping |
| Unique IDs for maintenance records | UUID library | `Date.now().toString(36)` | Same approach used for InvoiceId; no collision risk for small team |

**Key insight:** Every write operation in Phase 4 is either an append (new maintenance record) or a single-row update (condition update). Both are trivially handled by the existing `writeCSVWithLock` + `parseCSV` + `serializeCSV` chain that Phase 3 already established. There is nothing architecturally new here.

---

## Common Pitfalls

### Pitfall 1: Date string timezone offset causes off-by-one errors
**What goes wrong:** `new Date('2026-03-17')` is parsed as midnight UTC, which converts to the previous day in negative-UTC timezones (e.g. US timezones). Comparisons against `new Date()` (local time) fail by one day.
**Why it happens:** ISO date strings without a time component are treated as UTC by the spec. `new Date()` returns local time.
**How to avoid:** Always append `T00:00:00` before constructing dates from YYYY-MM-DD strings: `new Date(dateStr + 'T00:00:00')`. This forces local midnight parsing. Or compare date strings directly as strings when both are in `YYYY-MM-DD` format — string comparison works correctly for ISO dates: `'2026-03-18' > '2026-03-17'` is `true`.
**Warning signs:** Overdue items showing as "due today" when they are actually one day past due, or vice versa.

### Pitfall 2: condition.csv row-update vs. append confusion
**What goes wrong:** A condition update appends a second row for the same `UnitId` instead of updating the existing row. `loadConditionForUnit` then finds two rows and uses the first (stale) one.
**Why it happens:** The invoice append pattern (`rows.push(row)`) is incorrectly reused for condition updates.
**How to avoid:** The condition update function explicitly uses `findIndex` + mutate-in-place, not `push`. The save function must check: `if (idx >= 0) { rows[idx] = merged } else { rows.push(newRow) }`. Unit tests must cover both the "existing unit" and "first-time write" cases.
**Warning signs:** condition.csv grows a new row on every save; unit detail shows outdated mileage after edit.

### Pitfall 3: maintenance.csv 404 on first navigation to unit detail
**What goes wrong:** `downloadCSV` returns `{ text: null, hash: null }` because `maintenance.csv` has never been created. The render function crashes because `parseCSV(null)` returns `[]`, but code downstream assumes an array and `.filter()` is fine — however, `hash: null` passed to `writeCSVWithLock` is the first-write case, which works correctly (confirmed in Phase 3 research: `null !== null` is `false`, so no conflict is raised).
**How to avoid:** Treat 404 as "empty schedule, no error". `parseCSV(null)` already returns `[]`. Just ensure the render path handles zero maintenance records gracefully with an empty-state message.
**Warning signs:** Unit detail shows a JavaScript error instead of "No schedule configured yet" for newly added units.

### Pitfall 4: Router does not decode URI-encoded unit IDs
**What goes wrong:** A unit ID containing a hyphen like `TR-042` works fine, but if a unit ID ever contains a space or special character, `encodeURIComponent` in the link and `URLSearchParams` in the router may not round-trip cleanly.
**Why it happens:** Hash fragment query strings are not automatically decoded by the browser in all cases.
**How to avoid:** Always use `encodeURIComponent(unitId)` when building `#unit?id=` links, and `decodeURIComponent(params.id)` when reading in the router. Since the current unit IDs follow `TR-042` / `TL-017` format (alphanumeric + hyphen), this is low-risk but worth coding defensively now.
**Warning signs:** Unit detail page loads for `TR-042` but breaks for any unit with unusual characters.

### Pitfall 5: Inline edit form resets on re-render
**What goes wrong:** The user starts editing mileage, then the `hashchange` event fires (or a background refresh triggers a re-render), and the form resets to the stored value, losing unsaved input.
**Why it happens:** The unit detail view re-renders `container.innerHTML` on every navigation event.
**How to avoid:** Do not auto-refresh the unit detail view in the background while the user has an unsaved edit form open. Track `state.isEditing` flag; skip background refresh if true. Alternatively, keep the edit form values in a module-level variable and re-populate after re-render.
**Warning signs:** User types new mileage, taps another field, value disappears.

### Pitfall 6: CSV values containing commas in Notes/TireNotes fields
**What goes wrong:** A user enters `"Synthetic oil, changed filter"` in Notes. `parseCSV` splits on the comma, producing two extra phantom columns.
**Why it happens:** The CSV parser uses simple `.split(',')` without quoted-field support.
**How to avoid:** Either (a) strip commas from free-text inputs before saving (`notes.replace(/,/g, ' ')`), or (b) use a semicolon as the delimiter for free-text fields (display semicolons as commas in the UI). Option (a) is simpler and consistent with how Phase 3 handles the Cost field.
**Warning signs:** maintenance.csv rows with Notes parse into wrong columns; condition data appears shifted.

---

## Code Examples

### escapeHtml utility (shared pure function)

```javascript
// app/views/unit-detail.js or a shared app/utils.js
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

### isOverdue calculation

```javascript
// app/maintenance/schedule.js
export function isOverdue(record, todayStr, currentMiles) {
  // Time-based check
  if (record.IntervalDays && record.LastDoneDate) {
    const last = new Date(record.LastDoneDate + 'T00:00:00');
    last.setDate(last.getDate() + Number(record.IntervalDays));
    if (todayStr > last.toISOString().split('T')[0]) return true;
  }
  // Mileage-based check
  if (record.IntervalMiles && record.LastDoneMiles && currentMiles) {
    const dueMiles = Number(record.LastDoneMiles) + Number(record.IntervalMiles);
    if (Number(currentMiles) >= dueMiles) return true;
  }
  return false;
}

export function getDueDate(record) {
  if (!record.IntervalDays || !record.LastDoneDate) return null;
  const last = new Date(record.LastDoneDate + 'T00:00:00');
  last.setDate(last.getDate() + Number(record.IntervalDays));
  return last.toISOString().split('T')[0];
}

export function getDueMiles(record) {
  if (!record.IntervalMiles || !record.LastDoneMiles) return null;
  return Number(record.LastDoneMiles) + Number(record.IntervalMiles);
}
```

### DOT inspection status badge

```javascript
// Derived from condition.csv DotExpiry field
function dotStatus(dotExpiry, todayStr) {
  if (!dotExpiry) return { label: 'Unknown', cls: 'badge-unknown' };
  const daysUntil = Math.floor(
    (new Date(dotExpiry + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000
  );
  if (daysUntil < 0)   return { label: 'EXPIRED',         cls: 'badge-overdue' };
  if (daysUntil < 30)  return { label: `Due in ${daysUntil}d`, cls: 'badge-warning' };
  return { label: `Expires ${dotExpiry}`, cls: 'badge-ok' };
}
```

### Navigating to unit detail (link pattern)

```javascript
// In any view that lists units:
`<a href="#unit?id=${encodeURIComponent(u.UnitId)}" class="unit-link">${escapeHtml(u.UnitId)}</a>`
```

### Loading data in parallel for unit detail

```javascript
// app/views/unit-detail.js
async function loadUnitData(unitId, token, paths) {
  const [invResult, maintResult, condResult] = await Promise.allSettled([
    downloadCSV(paths.invoices, token),
    downloadCSV(paths.maintenance, token),
    downloadCSV(paths.condition, token),
  ]);

  const invoices    = parseCSV(invResult.status === 'fulfilled' ? invResult.value.text : null)
                        .filter(r => r.UnitId === unitId);
  const maintenance = parseCSV(maintResult.status === 'fulfilled' ? maintResult.value.text : null)
                        .filter(r => r.UnitId === unitId);
  const condRows    = parseCSV(condResult.status === 'fulfilled' ? condResult.value.text : null);
  const condition   = condRows.find(r => r.UnitId === unitId) || null;

  return { invoices, maintenance, condition };
}
```

Using `Promise.allSettled` (not `Promise.all`) means a 404 on `condition.csv` does not abort the entire page load. Each source degrades gracefully to empty.

---

## State of the Art

| Old Approach | Current Approach for Phase 4 | Impact |
|--------------|------------------------------|--------|
| No per-unit view; only invoice upload | Unit detail page at `#unit?id=` | FLEET-06: full history + schedule in one view |
| Static hash routes only | Router extended for query-param routes | Enables deep-linking to any unit |
| Only `invoices.csv` for data | Add `maintenance.csv` and `condition.csv` | FLEET-03/05: PM schedule and condition tracking |
| DueDate stored in data | DueDate computed at render time from interval + last done | No stale computed fields; interval changes take immediate effect |
| `Promise.all` for parallel loads | `Promise.allSettled` for resilient parallel loads | 404 on one CSV doesn't block the page |

---

## Open Questions

1. **Should "update last done" for a PM item re-read invoices.csv and auto-populate from matching invoices?**
   - What we know: invoices.csv `Type` field matches maintenance.csv `Type` field (both use the same slug values like `oil-change`)
   - What's unclear: Whether the team wants "mark as done" to be manual-only or auto-linked when an invoice with matching type is uploaded
   - Recommendation: For Phase 4, keep it manual. A user taps "Mark done today" on the unit detail page. Auto-linking from invoices is a Phase 5/6 enhancement. Manual-first is safer and simpler to test.

2. **How many maintenance types per unit is realistic?**
   - What we know: The upload form has ~8 preset types; a truck might have oil, tires, brakes, DOT, and a few custom types
   - What's unclear: Whether the team wants one global PM schedule or per-unit customization
   - Recommendation: Per-unit records in maintenance.csv (one row per UnitId + Type combination). This allows different intervals for different trucks without a global config table. A truck with 5 PM types has 5 rows in maintenance.csv.

3. **condition.csv: should tire data be a Notes free-text field or structured columns?**
   - What we know: FLEET-05 mentions "tire data" as a requirement; FEATURES.md deferred tire tracking to v2+
   - What's unclear: Whether "tire data" in FLEET-05 means tire rotation mileage or just a notes field
   - Recommendation: Use a single `TireNotes` free-text column for Phase 4 (e.g. "Replaced front steer 2026-01"). Structured tire rotation tracking per axle is v2+. This satisfies FLEET-05 without overengineering.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node.js) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test app/maintenance/schedule.test.js` |
| Full suite command | `node --test app/graph/csv.test.js app/invoice/record.test.js app/maintenance/schedule.test.js app/views/unit-detail.test.js` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLEET-02 | Invoice history filtered to a single unit ID | unit | `node --test app/views/unit-detail.test.js` | ❌ Wave 0 |
| FLEET-03 | PM record with IntervalDays produces correct DueDate | unit | `node --test app/maintenance/schedule.test.js` | ❌ Wave 0 |
| FLEET-03 | PM record with IntervalMiles produces correct DueMiles | unit | `node --test app/maintenance/schedule.test.js` | ❌ Wave 0 |
| FLEET-04 | isOverdue returns true when today > DueDate | unit | `node --test app/maintenance/schedule.test.js` | ❌ Wave 0 |
| FLEET-04 | isOverdue returns false when today <= DueDate | unit | `node --test app/maintenance/schedule.test.js` | ❌ Wave 0 |
| FLEET-04 | isOverdue returns true when currentMiles >= DueMiles | unit | `node --test app/maintenance/schedule.test.js` | ❌ Wave 0 |
| FLEET-05 | Condition update mutates existing row (not append) | unit | `node --test app/views/unit-detail.test.js` | ❌ Wave 0 |
| FLEET-05 | Condition first-write creates row when unit not in CSV | unit | `node --test app/views/unit-detail.test.js` | ❌ Wave 0 |
| FLEET-05 | DOT badge shows EXPIRED when DotExpiry < today | unit | `node --test app/views/unit-detail.test.js` | ❌ Wave 0 |
| FLEET-06 | Router parses `#unit?id=TR-042` → params.id === 'TR-042' | unit | `node --test app/views/unit-detail.test.js` | ❌ Wave 0 |
| FLEET-06 | Promise.allSettled: 404 on condition.csv renders empty condition (not error) | unit | `node --test app/views/unit-detail.test.js` | ❌ Wave 0 |

Note: `app/views/unit-detail.js` uses DOM APIs and `downloadCSV` (fetch). Tests use dependency injection (same pattern as `appendInvoiceRecord` in Phase 3) for the CSV layer. Pure schedule calculations in `app/maintenance/schedule.js` are fully testable without mocking.

### Sampling Rate

- **Per task commit:** `node --test app/maintenance/schedule.test.js`
- **Per wave merge:** `node --test app/graph/csv.test.js app/invoice/record.test.js app/maintenance/schedule.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `app/maintenance/schedule.js` — pure functions: `isOverdue`, `getDueDate`, `getDueMiles` (implements FLEET-03/04)
- [ ] `app/maintenance/schedule.test.js` — covers FLEET-03 and FLEET-04 overdue calculations
- [ ] `app/views/unit-detail.test.js` — covers FLEET-02, FLEET-05, FLEET-06 with DI pattern for csvOps
- [ ] `app/views/unit-detail.js` — the view itself (created in Wave 1, test file scaffolded in Wave 0)

*(Existing `app/graph/csv.test.js` and `app/invoice/record.test.js` need no changes for this phase)*

---

## Sources

### Primary (HIGH confidence)

- Direct codebase read: `app/graph/csv.js` — `downloadCSV`, `parseCSV`, `serializeCSV`, `writeCSVWithLock` signatures and behavior
- Direct codebase read: `app/invoice/record.js` — DI pattern for testable CSV operations; row-update vs. append distinction
- Direct codebase read: `app/state.js` — current `state.fleet` shape; confirmed extension points
- Direct codebase read: `app/router.js` — static route map; confirmed it needs query-param extension
- Direct codebase read: `app/main.js` — boot sequence; confirmed `loadFleetData` pattern to extend
- Direct codebase read: `app/storage/cache.js` — IndexedDB pattern if caching maintenance/condition is needed
- Direct codebase read: `app/invoice/record.test.js` — confirms DI pattern works for CSV-layer unit tests
- `.planning/phases/03-invoice-workflow/03-RESEARCH.md` — locked schema decisions (invoices.csv columns) that Phase 4 must read
- `.planning/research/SUMMARY.md` — locked decisions: CSV over Excel, optimistic locking, no server, folder structure
- `.planning/REQUIREMENTS.md` — FLEET-02 through FLEET-06 definitions

### Secondary (MEDIUM confidence)

- `.planning/research/FEATURES.md` — confirmed tire tracking deferred to v2+; DOT inspection is annual (12-month interval); dashboard is action-list only (not charts)
- `.planning/STATE.md` — accumulated decisions: DI pattern for csvOps, non-fatal CSV write on upload failure

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all patterns established in Phases 1-3
- Architecture: HIGH — CSV schemas, router extension, and view structure are fully deterministic from existing code + requirements
- Pitfalls: HIGH — all identified directly from code behavior (date timezone, row-update vs. append, 404 handling, HTML injection)

**Research date:** 2026-03-17
**Valid until:** 2026-06-17 (stable stack — Graph API, node:test, and native browser APIs are not fast-moving)

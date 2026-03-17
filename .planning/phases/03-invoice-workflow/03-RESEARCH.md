# Phase 3: Invoice Workflow - Research

**Researched:** 2026-03-16
**Domain:** Invoice form wiring, OneDrive folder/file operations, CSV record append, vanilla JS UI patterns
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INV-01 | User can select truck/trailer unit from fleet CSV data | `state.fleet.units` already populated by Phase 1 boot; unit selector must read from this array, not hardcode types |
| INV-02 | User can select invoice date via date picker | `<input type="date">` already present in upload.js; needs default-to-today and validation before upload |
| INV-03 | User can select maintenance type from presets or enter custom type | `<select id="serviceType">` with "other" text fallback already exists; no new UI primitives needed |
| INV-04 | File is auto-named as `UNIT_DATE_TYPE.pdf` | `getBaseName()` in upload.js already builds this; needs alignment with INV-01 unit ID format |
| INV-05 | PDF uploads to per-unit OneDrive folder (`/Fleet/UNIT/Invoices/`) | `ensureFolder` + `uploadFile` in files.js handle this; folder path constant must change from `Maintenance` to `Invoices` |
| INV-06 | Invoice record is appended to fleet CSV after upload (date, type, cost, PDF link) | `writeCSVWithLock` in csv.js already handles optimistic-lock append; needs an `invoices.csv` path added to state and a cost field added to the form |
</phase_requirements>

---

## Summary

Phase 3 closes the end-to-end invoice workflow. The required capabilities are almost entirely present in the codebase — this phase is primarily wiring and alignment work, not new invention. The upload form (`app/views/upload.js`) already has a date picker, service type selector with "other" fallback, filename preview, and OneDrive upload. The CSV layer (`app/graph/csv.js`) already has `writeCSVWithLock` for safe appended writes. The folder utility (`app/graph/files.js`) already has `ensureFolder` + `uploadFile`.

The four gaps to close are: (1) the unit selector currently uses two free-text fields (`unitType` + `unitNum`) instead of a dropdown driven from `state.fleet.units`; (2) the upload folder path is `Maintenance` but the spec says `Invoices`; (3) there is no cost field on the form; and (4) there is no `invoices.csv` path in state or boot sequence. Everything else is already wired.

The only non-trivial decision is the `invoices.csv` schema and where it lives on OneDrive. This must be locked in this phase because Phase 4 (Maintenance Tracking) reads invoice history from that file. The schema must include: `InvoiceId`, `UnitId`, `Date`, `Type`, `Cost`, `PdfPath`. Cost is optional at entry time (user may not know it yet) but the column must exist so Phase 4 doesn't require a schema migration.

**Primary recommendation:** Wire `state.fleet.units` into a single `<select>` for unit, add a cost field, change folder path from `Maintenance` to `Invoices`, and append a row to `invoices.csv` after each successful upload. No new libraries. No new architecture.

---

## Standard Stack

### Core (already in use — no additions needed)

| Library / API | Version | Purpose | Status |
|---------------|---------|---------|--------|
| `app/graph/csv.js` | Phase 1 | Download, parse, serialize, optimistic-lock write of CSVs | Already built |
| `app/graph/files.js` | Phase 1 | `ensureFolder` + `uploadFile` to OneDrive via Graph API | Already built |
| `app/views/upload.js` | Phase 2 | Upload form with scanner, OCR prefill, filename preview, submit | Already built |
| `app/state.js` | Phase 1 | Shared singleton; `state.fleet.units` populated at boot | Already built |
| `app/storage/cache.js` | Phase 1 | IndexedDB cache for fleet data | Already built |
| Microsoft Graph API v1.0 | n/a | OneDrive file PUT, folder creation | Already wired |
| node:test | built-in | Zero-dependency test runner | Already used in csv.test.js, scanner.test.js |

### What NOT to add

- No new CDN libraries
- No SheetJS — plain CSV is sufficient
- No date libraries — `new Date().toISOString().split('T')[0]` is sufficient for YYYY-MM-DD
- No UUID libraries — `Date.now().toString(36)` is sufficient for a simple `InvoiceId`

---

## Architecture Patterns

### Current Unit Selector (must change for INV-01)

The existing form uses two separate inputs:
```html
<select id="unitType">  <!-- Trucks | Trailers -->
<input  id="unitNum">   <!-- free text: "042" -->
```
This does not satisfy INV-01 ("select from fleet roster"). The replacement is a single `<select id="unitId">` populated from `state.fleet.units`.

**units.csv columns (confirmed from Phase 1 parseCSV output):**
The CSV is parsed into objects keyed by header row. The existing `state.fleet.units` array contains objects whose keys match the CSV header. Check the actual CSV to confirm column names, but the pattern is consistent: each unit has at minimum a unique ID, type (Truck/Trailer), and number.

**Pattern for populating unit select from state:**
```javascript
// Source: app/views/upload.js renderApp() pattern — adapt for dynamic options
function buildUnitOptions() {
  const units = state.fleet.units;
  if (!units.length) {
    return '<option value="">No units loaded</option>';
  }
  return units.map(u =>
    `<option value="${u.UnitId}">${u.UnitId} — ${u.Type || ''}</option>`
  ).join('');
}
```

The unit select must handle the "fleet not loaded yet" case gracefully — either show a loading state or disable the select until `state.fleet.units.length > 0`. Because fleet loading is non-blocking (fire-and-forget in `main.js`), the form may render before units arrive. The safe pattern is: re-render the unit select after `loadFleetData()` resolves, or use a MutationObserver. The simplest approach: expose a `refreshUnitSelect()` helper that `main.js` calls after `loadFleetData()` completes.

### Filename Format (INV-04)

Current `getBaseName()` produces: `TR-042_oil-change_2026-03-16`

Required format per spec: `UNIT_DATE_TYPE.pdf` where UNIT is the full unit ID (e.g. `TR-042`).

The current function already builds this structure. When the unit selector changes from two inputs to one `<select id="unitId">`, `getBaseName()` reads the selected `UnitId` directly instead of concatenating type prefix + padded number. This is a simplification.

```javascript
// Revised getBaseName() — reads unitId directly
function getBaseName() {
  const unitId = document.getElementById('unitId')?.value || '';
  const svc    = getServiceLabel();
  const date   = document.getElementById('serviceDate')?.value || '';
  if (!unitId || !svc || !date) return null;
  return `${unitId}_${date}_${svc}`;
}
```

### Folder Path (INV-05)

Current path in `handleSubmit()`:
```javascript
const folderPath = `${CONFIG.ONEDRIVE_BASE}/${type}/${prefix}-${num}/Maintenance`;
```

Required path per spec: `/Fleet/UNIT/Invoices/`

The `CONFIG.ONEDRIVE_BASE` is `'Fleet Maintenance'`. The revised path:
```javascript
const folderPath = `${CONFIG.ONEDRIVE_BASE}/${unitId}/Invoices`;
```
Note: the existing path goes `Fleet Maintenance/Trucks/TR-042/Maintenance` — it inserts a type subfolder. The spec says `/Fleet/UNIT/Invoices/` with no type level. This changes the folder structure. Since Phase 1 and 2 are complete but no invoices have been filed to production yet, this is safe to change now without migration.

**Locked folder structure:**
```
Fleet Maintenance/
  TR-042/
    Invoices/
      TR-042_2026-03-16_oil-change.pdf
  TL-017/
    Invoices/
      TL-017_2026-03-10_dot-inspection.pdf
  data/
    units.csv
    invoices.csv        ← new in Phase 3
```

### invoices.csv Schema (INV-06)

**Path in state:** `Fleet Maintenance/data/invoices.csv`

**Columns (locked for Phase 4 compatibility):**
```
InvoiceId,UnitId,Date,Type,Cost,PdfPath
```

| Column | Format | Example | Notes |
|--------|--------|---------|-------|
| `InvoiceId` | `{timestamp_base36}` | `lxk4f2a` | `Date.now().toString(36)` — unique, no UUID library needed |
| `UnitId` | Unit ID from roster | `TR-042` | Foreign key to units.csv |
| `Date` | `YYYY-MM-DD` | `2026-03-16` | ISO date, matches filename |
| `Type` | Service type slug | `oil-change` | Matches filename component |
| `Cost` | Decimal or empty | `450.00` | Empty string allowed if user skips |
| `PdfPath` | OneDrive relative path | `Fleet Maintenance/TR-042/Invoices/TR-042_2026-03-16_oil-change.pdf` | Used by Phase 4 to link invoice |

**Append pattern using existing writeCSVWithLock:**
```javascript
// Source: app/graph/csv.js writeCSVWithLock signature
async function appendInvoiceRecord(invoiceRow, token) {
  const { text, hash } = await downloadCSV(state.fleet.invoicesPath, token);

  // invoices.csv may not exist yet — handle 404 gracefully
  const headers = ['InvoiceId', 'UnitId', 'Date', 'Type', 'Cost', 'PdfPath'];
  const rows = text ? parseCSV(text) : [];
  rows.push(invoiceRow);

  const newText = serializeCSV(headers, rows);
  // On first write, originalHash is null — writeCSVWithLock must handle null hash
  // as "file does not exist, create it" rather than "conflict detected"
  await writeCSVWithLock(state.fleet.invoicesPath, hash, newText, token);
}
```

**Critical edge case:** `writeCSVWithLock` re-downloads the file to check the hash. If the file does not exist (404), `downloadCSV` returns `{ text: null, hash: null }`. The current implementation compares `currentHash !== originalHash`, which is `null !== null` = `false` — this works correctly for the first write. No change to `writeCSVWithLock` is needed.

### state.js additions needed

```javascript
// Add to state.fleet in app/state.js:
fleet: {
  units:         [],
  unitsHash:     null,
  unitsPath:     'Fleet Maintenance/data/units.csv',
  invoices:      [],          // ← new: loaded in background (optional for Phase 3)
  invoicesHash:  null,        // ← new: used by writeCSVWithLock
  invoicesPath:  'Fleet Maintenance/data/invoices.csv',  // ← new
},
```

### Cost field (INV-06 implicit requirement)

The invoice record schema includes `Cost`. The upload form needs a cost input. This is a simple text/number field alongside the existing date and mileage row:

```html
<div class="field">
  <label>Cost (opt.)</label>
  <input type="text" id="invoiceCost" placeholder="450.00"
    inputmode="decimal"/>
</div>
```

Cost is optional — the record is still written if Cost is blank. The filename does NOT include cost (spec says `UNIT_DATE_TYPE.pdf`).

### Anti-Patterns to Avoid

- **Do not re-read `invoices.csv` on every form render** — only read it when about to write (inside `appendInvoiceRecord`). The write path already does this via `writeCSVWithLock`.
- **Do not block the upload on CSV write failure** — PDF upload to OneDrive is the primary action. If `appendInvoiceRecord` throws, show a non-fatal warning toast ("Uploaded — but invoice record could not be saved. Tap to retry.") and do not roll back the file.
- **Do not introduce a Truck/Trailer type subfolder** — the spec path is `/Fleet/UNIT/Invoices/` with no type level. The existing code has an extra `Trucks/` or `Trailers/` segment that must be removed.
- **Do not hardcode unit options** — the unit dropdown must always read from `state.fleet.units`. Never hardcode unit numbers.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optimistic CSV locking | Custom mutex/semaphore | `writeCSVWithLock` in csv.js | Already built and tested in Phase 1 |
| OneDrive folder creation | Recursive mkdir | `ensureFolder` in files.js | Already built, handles all nested path cases |
| PDF upload with auth header | Custom fetch wrapper | `uploadFile` in files.js | Already handles `Authorization` header and error throwing |
| CSV parse/serialize | Custom string split logic | `parseCSV` / `serializeCSV` in csv.js | Already tested; handles trim, empty lines, header mapping |
| Date formatting | moment.js or date-fns | `new Date().toISOString().split('T')[0]` | Already in use; no library needed for YYYY-MM-DD |
| Unique IDs | UUID library | `Date.now().toString(36)` | Sufficient for single-user tool; no collision risk at this scale |

---

## Common Pitfalls

### Pitfall 1: Folder path still has type subfolder
**What goes wrong:** Files go to `Fleet Maintenance/Trucks/TR-042/Invoices/` instead of `Fleet Maintenance/TR-042/Invoices/`. Phase 4 folder listing breaks.
**Why it happens:** `handleSubmit()` currently constructs `${CONFIG.ONEDRIVE_BASE}/${type}/${prefix}-${num}/Maintenance`. Both the `/${type}/` segment and the `Maintenance` folder name must change.
**How to avoid:** Replace the folder construction with `${CONFIG.ONEDRIVE_BASE}/${unitId}/Invoices` where `unitId` comes directly from the unit select value.
**Warning signs:** Uploaded file appears under a "Trucks" or "Trailers" subfolder in OneDrive.

### Pitfall 2: Unit select renders before state.fleet.units is populated
**What goes wrong:** The select renders empty because `loadFleetData()` is fire-and-forget and may not have finished when `render()` runs.
**Why it happens:** `main.js` calls `loadFleetData()` without `await` so the UI is not blocked. The fleet may load after the view renders.
**How to avoid:** After the unit options are built, re-populate the select when `loadFleetData()` resolves. The cleanest approach: `main.js` calls a `refreshView()` exported from `upload.js` after `loadFleetData()` resolves, or `upload.js` polls `state.fleet.units` length. Simplest: export a `refreshUnitSelect(container)` function from upload.js that main.js calls post-load.
**Warning signs:** Unit dropdown shows "No units loaded" even after a delay, or first upload always uses empty unit.

### Pitfall 3: writeCSVWithLock conflict on simultaneous uploads
**What goes wrong:** Two users upload at the same moment. Both read invoices.csv with the same hash. One succeeds; the other throws `CSV_CONFLICT`.
**Why it happens:** Hash has changed between the two reads.
**How to avoid:** Catch `CSV_CONFLICT` specifically, re-download, merge (append the new row to the freshly downloaded list), retry once. For a 2-3 person team, a single auto-retry is sufficient. Show an error toast only if the retry also fails.
**Warning signs:** Upload succeeds (PDF is on OneDrive) but "invoice record could not be saved" toast appears occasionally.

### Pitfall 4: Cost field value included in filename
**What goes wrong:** `getBaseName()` accidentally incorporates cost or mileage into the filename, breaking the `UNIT_DATE_TYPE.pdf` format.
**Why it happens:** The existing `getBaseName()` already appends `_${mi}mi` for mileage. Cost must not be treated the same way.
**How to avoid:** Cost is only written to the CSV record, never to the filename. `getBaseName()` must not read `invoiceCost`.

### Pitfall 5: parseCSV fails on cost values with commas
**What goes wrong:** A cost like `1,450.00` (using comma as thousands separator) breaks CSV parsing because the comma is the field delimiter.
**Why it happens:** `parseCSV` uses `.split(',')` without quoted-field handling.
**How to avoid:** Validate/sanitize cost input to accept only digits and a decimal point. Strip commas before storing. Or store as integer cents (`145000`). Simplest: `parseFloat(costInput.replace(/,/g, ''))` before writing to CSV.

### Pitfall 6: invoices.csv missing on first upload
**What goes wrong:** `writeCSVWithLock` is called on a path that returns 404 on first re-download. Hash is `null` both times. This actually works correctly (null === null), BUT the `PUT` must write a file with a header row, not an empty file.
**Why it happens:** If `appendInvoiceRecord` serializes `[]` rows, the output is just the header row — which is correct. Verify `serializeCSV(headers, [])` returns `'InvoiceId,UnitId,Date,Type,Cost,PdfPath'` with no trailing newline. From the code, it does: `[headerLine, ...dataLines].join('\n')` where `dataLines` is empty produces just `headerLine`.

---

## Code Examples

### Revised handleSubmit (core changes only)

```javascript
// Source: app/views/upload.js handleSubmit() — show key changes
async function handleSubmit() {
  if (state.isUploading) return;
  state.isUploading = true;

  const unitId  = document.getElementById('unitId').value;     // ← was unitType+unitNum
  const cost    = document.getElementById('invoiceCost')?.value.trim() || '';
  const svc     = getServiceLabel();
  const date    = document.getElementById('serviceDate').value;

  // Path uses unitId directly, folder is Invoices not Maintenance
  const folderPath = `${CONFIG.ONEDRIVE_BASE}/${unitId}/Invoices`;

  // ... ensureFolder, uploadFile (unchanged) ...

  // After successful upload, append to invoices.csv
  const invoiceRow = {
    InvoiceId: Date.now().toString(36),
    UnitId:    unitId,
    Date:      date,
    Type:      svc,
    Cost:      cost,
    PdfPath:   `${folderPath}/${fileName}`,
  };
  try {
    await appendInvoiceRecord(invoiceRow);
  } catch (err) {
    // Non-fatal: PDF is already uploaded
    showToast('Uploaded — invoice record could not be saved', 'warning');
    console.error('CSV append failed:', err);
  }
}
```

### appendInvoiceRecord

```javascript
// New function in upload.js or extracted to app/graph/invoices.js
import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock } from '../graph/csv.js';

const INVOICE_HEADERS = ['InvoiceId', 'UnitId', 'Date', 'Type', 'Cost', 'PdfPath'];

async function appendInvoiceRecord(row) {
  const path = state.fleet.invoicesPath;
  const { text, hash } = await downloadCSV(path, state.token);
  const rows = text ? parseCSV(text) : [];
  rows.push(row);
  const newText = serializeCSV(INVOICE_HEADERS, rows);
  await writeCSVWithLock(path, hash, newText, state.token);
}
```

### Unit select populated from state

```javascript
// In renderApp(), replace the two-field unit row with:
`<div class="field">
  <label>Unit</label>
  <div class="select-wrap">
    <select id="unitId">
      ${state.fleet.units.length
        ? state.fleet.units.map(u =>
            `<option value="${u.UnitId}">${u.UnitId}</option>`
          ).join('')
        : '<option value="">Loading units…</option>'
      }
    </select>
  </div>
</div>`
```

---

## State of the Art

| Old Approach (current) | Required Approach (Phase 3) | Impact |
|------------------------|----------------------------|--------|
| Unit = type select + number text input | Unit = single select from `state.fleet.units` | INV-01: roster-driven, no free-text typos |
| Folder: `Fleet Maintenance/Trucks/TR-042/Maintenance` | Folder: `Fleet Maintenance/TR-042/Invoices` | INV-05: correct path, no type-level subfolder |
| No cost field | Cost field (optional, numeric) | INV-06: invoice record includes cost |
| No CSV append after upload | Append row to `invoices.csv` after upload | INV-06: audit record created |
| `state.fleet` has only `units/unitsHash/unitsPath` | Add `invoices/invoicesHash/invoicesPath` | Phase 4 reads invoice history from state |

---

## Open Questions

1. **units.csv column names for UnitId**
   - What we know: `parseCSV` produces objects keyed by header row; Phase 1 built the CSV layer
   - What's unclear: The exact header name for the unit identifier (is it `UnitId`, `Id`, `Unit`, something else?)
   - Recommendation: Read the actual `units.csv` file on OneDrive at the start of Phase 3 Wave 0 work, or check Phase 1 plan/code for the schema definition. If the column is not `UnitId`, update the unit select template accordingly. The research assumes `UnitId` based on the csv.test.js fixture (`UnitId,Type,Number`).

2. **How to handle "units still loading" at form render time**
   - What we know: `loadFleetData()` is fire-and-forget; the unit select may render empty
   - What's unclear: Whether `main.js` should export a post-load callback hook or whether `upload.js` should use a polling/retry approach
   - Recommendation: Simplest path is for `main.js` to call `import { refreshUnitSelect } from './views/upload.js'` after `loadFleetData()` resolves and call it if the upload view is active. Keeps the coupling in `main.js` where the boot sequence already lives.

3. **CSV_CONFLICT retry UX**
   - What we know: `writeCSVWithLock` throws `CSV_CONFLICT` on hash mismatch; for a 2-3 person team this is rare
   - What's unclear: Whether to auto-retry once silently or surface it to the user
   - Recommendation: Auto-retry once (re-download, re-append, re-write). If retry also fails, show toast: "Invoice filed but record not saved — tap to retry." Store the pending row in module-level state for the retry handler.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node.js 24.13.0) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test app/graph/csv.test.js` |
| Full suite command | `node --test app/graph/csv.test.js app/imaging/scanner.test.js app/imaging/ocr.test.js` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INV-01 | Unit options built from `state.fleet.units` array | unit | `node --test app/views/upload.test.js` | ❌ Wave 0 |
| INV-02 | Date defaults to today; submit blocked when empty | unit | `node --test app/views/upload.test.js` | ❌ Wave 0 |
| INV-03 | `getServiceLabel()` returns custom text when "other" selected | unit | `node --test app/views/upload.test.js` | ❌ Wave 0 |
| INV-04 | `getBaseName()` returns `UNIT_DATE_TYPE` format | unit | `node --test app/views/upload.test.js` | ❌ Wave 0 |
| INV-05 | `folderPath` is `Fleet Maintenance/UNIT/Invoices` | unit | `node --test app/views/upload.test.js` | ❌ Wave 0 |
| INV-06 | `appendInvoiceRecord` calls `writeCSVWithLock` with correct row shape | unit | `node --test app/graph/invoices.test.js` | ❌ Wave 0 |
| INV-06 | First-write (null hash) creates header + data row | unit | `node --test app/graph/invoices.test.js` | ❌ Wave 0 |
| INV-06 | `CSV_CONFLICT` triggers one auto-retry | unit | `node --test app/graph/invoices.test.js` | ❌ Wave 0 |

Note: upload.js uses DOM APIs (`document.getElementById`). Tests for `getBaseName()` and `getServiceLabel()` must either use jsdom or extract these as pure functions with explicit argument passing. **Recommended:** Extract `getBaseName(unitId, svc, date)` and `buildFolderPath(unitId)` as pure functions that take explicit arguments — this makes them testable without jsdom and improves cohesion.

### Sampling Rate
- **Per task commit:** `node --test app/graph/csv.test.js`
- **Per wave merge:** `node --test app/graph/csv.test.js app/imaging/ocr.test.js app/graph/invoices.test.js app/views/upload.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `app/views/upload.test.js` — covers INV-01 through INV-05 (pure function extractions)
- [ ] `app/graph/invoices.test.js` — covers INV-06 (appendInvoiceRecord with mocked fetch)

*(Existing `app/graph/csv.test.js` covers the locking layer; no changes needed there)*

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `app/views/upload.js` — current form structure, naming logic, submit handler
- Direct codebase read: `app/graph/csv.js` — `writeCSVWithLock`, `parseCSV`, `serializeCSV` signatures
- Direct codebase read: `app/graph/files.js` — `ensureFolder`, `uploadFile` signatures
- Direct codebase read: `app/state.js` — current `state.fleet` shape
- Direct codebase read: `app/main.js` — boot sequence, non-blocking fleet load
- Direct codebase read: `app/graph/csv.test.js` — confirms `null !== null` hash behavior for 404 case
- Direct codebase read: `app/graph/auth.js` — `CONFIG.ONEDRIVE_BASE = 'Fleet Maintenance'`

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` — locked decisions: CSV over Excel, optimistic locking pattern, folder structure recommendation
- `.planning/REQUIREMENTS.md` — INV-01 through INV-06 definitions
- `.planning/STATE.md` — accumulated decisions from Phase 1 and 2

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new dependencies needed
- Architecture: HIGH — folder path change and CSV schema are fully deterministic from spec + codebase audit
- Pitfalls: HIGH — identified directly from code (folder path, null hash, comma in cost, units-not-loaded timing)

**Research date:** 2026-03-16
**Valid until:** 2026-06-16 (stable stack — Graph API and node:test are not fast-moving)

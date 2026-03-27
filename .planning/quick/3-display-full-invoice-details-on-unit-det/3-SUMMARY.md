---
phase: quick
plan: 3
subsystem: unit-detail / invoice-history
tags: [invoice, unit-detail, table, mobile]
dependency_graph:
  requires: []
  provides: [expanded-invoice-table]
  affects: [app/views/unit-detail.js, style.css]
tech_stack:
  added: []
  patterns: [two-row-table-pattern, :has()-css-selector]
key_files:
  modified:
    - app/views/unit-detail.js
    - style.css
decisions:
  - Two-row pattern (primary + detail) chosen over extra columns to keep mobile table readable at 320px
  - Detail row suppressed entirely when all three extra fields are empty — no visible change for legacy invoices
  - :has() CSS selector used to remove primary-row border-bottom when a detail row follows (no JS needed)
  - Summary gets white-space:normal so long text wraps; Vendor and Inv# stay nowrap for scannability
metrics:
  duration: 3min
  completed_date: "2026-03-26"
  tasks_completed: 1
  files_modified: 2
---

# Quick Task 3: Display Full Invoice Details on Unit Detail Page Summary

**One-liner:** Expanded invoice history table with conditional detail rows showing Vendor, Inv#, and Summary using a two-row CSS pattern and :has() border suppression.

## What Was Built

The invoice history table on the unit detail page previously showed only 4 columns (Date, Type, Cost, PDF). Each invoice now renders a second detail row below it when any of the three extra CSV fields (Vendor, InvoiceNumber, Summary) are non-empty. Invoices that have none of those fields are visually identical to the prior layout.

### Layout

```
| Date       | Type        | Cost   | PDF  |
| Vendor: Petro One  Inv#: 10042  Summary: Oil change and filter |  (colspan=4)
```

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Expand invoice table with Vendor, Invoice#, and Summary detail rows | a5ad688 | app/views/unit-detail.js, style.css |

## Changes Made

### app/views/unit-detail.js

The `invoices.map(inv => ...)` template literal was extended. After the closing `</tr>` of the primary row, a conditional detail row is appended:

- Condition: `inv.Vendor || inv.InvoiceNumber || inv.Summary`
- Detail row: `<tr class="invoice-detail-row"><td colspan="4">...</td></tr>`
- Each field is wrapped in `<span class="invoice-detail-item">` only when non-empty
- All values run through `escapeHtml()` per project convention

### style.css (lines 659-663)

```css
.invoice-detail-row td { font-size: 12px; color: var(--text-2); border-bottom: 1px solid var(--border); }
.invoice-detail-row + tr td { border-top: none; }
.invoice-detail-item { margin-right: 12px; display: inline-block; white-space: nowrap; }
.invoice-detail-item:last-child { white-space: normal; }
tr:has(+ .invoice-detail-row) td { border-bottom: none; }
```

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `grep inv.Vendor app/views/unit-detail.js` — found at line 446
- `grep inv.InvoiceNumber app/views/unit-detail.js` — found at line 447
- `grep inv.Summary app/views/unit-detail.js` — found at line 448
- `grep invoice-detail style.css` — 5 rules found at lines 659-663
- Primary row PDF links use `data-action="view-pdf"` — unchanged
- Detail row omitted when all three fields empty — confirmed by conditional template expression

## Self-Check: PASSED

- `app/views/unit-detail.js` modified and committed: a5ad688
- `style.css` modified and committed: a5ad688
- Commit a5ad688 exists in git log

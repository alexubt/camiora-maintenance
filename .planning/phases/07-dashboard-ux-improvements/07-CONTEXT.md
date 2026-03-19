# Phase 7: Dashboard & UX Improvements - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning
**Source:** feature-dev:feature-dev audit with 3 parallel code-explorer agents

<domain>
## Phase Boundary

Fix all issues identified in the feature-dev audit of the maintenance dashboard and unit detail page. 14 improvement items across UX, visual polish, and functional gaps.

</domain>

<decisions>
## Implementation Decisions

### B4: Fleet Summary Bar
- Add a summary strip above the category tabs showing: total units, total overdue count, total due-soon count
- Visible on all tabs (not filtered by active category)

### B5: Color-Coded Milestone Rows
- Replace emoji icons (❌/✅/⬜) on dashboard unit cards with colored text/indicators
- Red text for overdue items, green for OK, gray for not-tracked
- Must work in both light and dark mode (use CSS variables)

### B6: Search/Filter Units
- Search bar on dashboard that filters unit cards by Unit ID (case-insensitive substring match)
- Optional: status filter dropdown (All / Overdue / Due Soon / OK)
- Search should work within the active category tab

### B7: Filter Action Items by Tab
- Action item banners (overdue/due-soon) should filter to show only units matching the active category tab
- "All caught up" message should reflect the filtered view

### B8: Expanded Add Unit Form
- Collect all unit attributes when adding: UnitId, Type, VIN, PlateNr, Make, Model, Year, DotExpiry
- Current form only has UnitId and Type
- Must update UNIT_HEADERS usage in appendUnit

### C9: Dark Mode Fix — Unit Detail
- Replace all inline hardcoded hex colors (#dee2e6, #eee, #ddd, etc.) with CSS variables
- The milestone table, tire monitor, notable mentions, mileage input all use raw style="" attributes
- Extract to CSS classes where possible
- statusBadge() in both dashboard.js and unit-detail.js uses inline background:#dc3545 — should use CSS classes

### C10: Loading Skeletons
- Replace "Loading fleet data..." and "Loading unit data..." plain text with skeleton placeholder shapes
- Skeleton should roughly match the layout of the actual content (card shapes, table rows)
- CSS-only animation (shimmer/pulse), no JS needed

### C11: Hide Tab Scrollbar
- Category tabs horizontal scroll container shows a scrollbar on Android Chrome
- Add scrollbar-width:none and ::-webkit-scrollbar{display:none}

### C12: Back Link Tap Feedback
- Back links on unit detail page have no :active state, no icon
- Add a ← chevron icon and :active opacity/color change
- Make them feel like buttons (padding, touch target)

### C13: Empty State Icons and CTAs
- Dashboard empty tab: "No trucks in the fleet yet" — add an icon and "Add your first truck" CTA button
- Invoice history empty: "No invoices recorded yet" — add icon and "Upload an invoice" link to #upload
- Milestone table when no milestones tracked — guidance text

### D14: Edit Unit Attributes
- Add an "Edit" button on the unit detail info card
- Opens inline form to edit: VIN, PlateNr, Make, Model, Year, DotExpiry
- Saves back to units.csv via download→parse→update-row→serialize→writeCSVWithLock
- This is a row-update (like condition.csv), not an append

### D15: Delete Unit
- Add a "Delete" button on unit detail page (maybe in a danger zone at bottom)
- Confirmation prompt before deleting
- Removes the row from units.csv via download→parse→filter-out→serialize→writeCSVWithLock
- Should also clean up related maintenance.csv and condition.csv rows for that UnitId

### D16: Quick Mileage Update from Dashboard
- Each unit card on the dashboard should have a small mileage input
- Tap to update mileage without navigating to unit detail
- Saves to condition.csv via saveConditionUpdate

### D17: Fix Invoice PDF Links
- Current links use Graph API content URL which requires auth
- Need to either: use a download URL that includes the token, or fetch the file via JS and open as blob URL
- Recommended: fetch with Bearer token → create blob URL → open in new tab

### Claude's Discretion
- Exact skeleton shape/animation design
- Whether to batch the CSS refactor items or do them alongside their functional changes
- How to handle the delete confirmation UX (modal vs inline)
- Grouping of items into plans/waves

</decisions>

<specifics>
## Specific Ideas

- The existing codebase uses `saveConditionUpdate()` for row-update pattern — reuse for unit attribute editing
- `appendUnit()` in fleet/units.js needs a sibling `updateUnit()` and `deleteUnit()` function
- The statusBadge() function appears in both dashboard.js and unit-detail.js — could extract to a shared helper
- Loading skeletons can be pure CSS with @keyframes shimmer on a gradient background
- Invoice PDF fix: `const resp = await fetch(graphUrl, { headers: { Authorization: 'Bearer ' + token } }); const blob = await resp.blob(); window.open(URL.createObjectURL(blob));`

</specifics>

<deferred>
## Deferred Ideas

- B6 advanced: full-text search across unit attributes (VIN, plate) — just Unit ID for now
- Drag-to-reorder tire positions
- Bulk mileage update for all units at once
- Export fleet report as PDF

</deferred>

---
*Phase: 07-dashboard-ux-improvements*
*Context gathered: 2026-03-19 via feature-dev audit*

# Roadmap: Camiora Fleet Maintenance PWA

## Overview

This roadmap transforms the existing working PWA skeleton (auth, upload, scanner) into a production-quality fleet maintenance tool. Phase 1 breaks the monolith and establishes the CSV data layer that every feature depends on. Phase 2 polishes the scanner and adds OCR auto-fill. Phase 3 closes the complete invoice workflow end-to-end. Phase 4 adds maintenance tracking. Phase 5 delivers the action-focused dashboard. Phase 6 hardens auth and PWA reliability before distribution.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - ES module refactor and CSV data layer (unit roster, optimistic locking) (completed 2026-03-17)
- [x] **Phase 2: Scanner and OCR** - Production-quality scanner with deskew, B&W, and OCR auto-fill (completed 2026-03-17)
- [x] **Phase 3: Invoice Workflow** - Complete end-to-end invoice capture, naming, upload, and record (completed 2026-03-17)
- [x] **Phase 4: Maintenance Tracking** - Per-unit PM schedules, overdue alerts, condition data, unit detail pages (completed 2026-03-17)
- [x] **Phase 5: Dashboard** - Action-focused main screen showing what needs attention now (completed 2026-03-17)
- [x] **Phase 6: Auth Hardening and PWA Reliability** - Silent token refresh, Home Screen install, offline queue (completed 2026-03-17)

## Phase Details

### Phase 1: Foundation
**Goal**: The codebase is modular and every feature can read the fleet unit roster from OneDrive
**Depends on**: Nothing (existing brownfield baseline)
**Requirements**: INFRA-04, FLEET-01, FLEET-07
**Success Criteria** (what must be TRUE):
  1. The app loads from ES modules (`app/main.js`, `app/router.js`) with no monolith `app.js` in active use
  2. Unit roster (trucks and trailers) is fetched from OneDrive CSV and available to the invoice form on page load
  3. A write to the fleet CSV succeeds only when the file hash matches the version last read (optimistic lock in place)
  4. The hash-based router switches between `#upload` and other views without page reload
**Plans:** 3/3 plans complete

Plans:
- [ ] 01-01-PLAN.md — CSV data layer with tests (parseCSV, hashText, optimistic lock) + state/cache modules
- [x] 01-02-PLAN.md — ES module refactor: extract auth, files, upload view, create router and main.js
- [ ] 01-03-PLAN.md — Browser verification checkpoint (human-verify full app works)

### Phase 2: Scanner and OCR
**Goal**: The scanner produces document-quality output and automatically reads invoice fields
**Depends on**: Phase 1
**Requirements**: SCAN-01, SCAN-02, SCAN-03, SCAN-04, OCR-01, OCR-02, OCR-03
**Success Criteria** (what must be TRUE):
  1. A photo of an invoice is converted to high-contrast B&W that looks like a scanned document
  2. A crooked photo is automatically straightened before PDF generation
  3. Capturing and processing multiple invoices in sequence does not crash the app on an older iPhone
  4. OCR extracts text from the scanned image and pre-populates the unit, date, and type fields on the invoice form
  5. User can review and correct any OCR-detected field before submitting the upload
**Plans:** 3/3 plans complete

Plans:
- [ ] 02-01-PLAN.md — Extract scanner module, fix black corners, add deskew, upgrade jsPDF, unit tests
- [ ] 02-02-PLAN.md — Canvas memory fix (blob-based), OCR module with lazy Tesseract.js, form auto-fill
- [ ] 02-03-PLAN.md — Browser verification checkpoint (human-verify scanner + OCR on mobile)

### Phase 3: Invoice Workflow
**Goal**: A user can snap, categorize, and file an invoice to OneDrive in under two minutes with a complete audit record
**Depends on**: Phase 2
**Requirements**: INV-01, INV-02, INV-03, INV-04, INV-05, INV-06
**Success Criteria** (what must be TRUE):
  1. User can select a truck or trailer unit from the fleet roster on the upload form
  2. User can pick the invoice date from a date picker and choose a maintenance type (preset or custom)
  3. The filename preview shows `UNIT_DATE_TYPE.pdf` before the user taps upload
  4. The PDF uploads to the correct per-unit OneDrive folder (`/Fleet/UNIT/Invoices/`)
  5. An invoice record (date, type, cost, PDF link) is appended to the fleet CSV after successful upload
**Plans:** 3/3 plans complete

Plans:
- [ ] 03-01-PLAN.md — TDD: Extract pure naming functions + invoice record module with tests
- [ ] 03-02-PLAN.md — Wire upload form: unit select, cost field, handleSubmit, preview
- [ ] 03-03-PLAN.md — Browser verification checkpoint (human-verify full invoice workflow)

### Phase 4: Maintenance Tracking
**Goal**: The fleet team can see each unit's maintenance schedule, condition, and full invoice history in one place
**Depends on**: Phase 3
**Requirements**: FLEET-02, FLEET-03, FLEET-04, FLEET-05, FLEET-06
**Success Criteria** (what must be TRUE):
  1. A unit's complete invoice history (date, vendor, cost, type, PDF link) is visible on its detail page
  2. Scheduled maintenance intervals (oil, tires, brakes, DOT inspection) can be configured per unit with due dates
  3. Overdue maintenance items are visually flagged on the unit detail page
  4. Unit condition data (mileage/hours, DOT inspection status) can be viewed and updated per unit
  5. A user can navigate to any unit's detail page and see its full history, condition, and upcoming PM schedule in one view
**Plans:** 3/3 plans complete

Plans:
- [x] 04-01-PLAN.md — TDD: Pure schedule functions (getDueDate, getDueMiles, isOverdue) with tests
- [x] 04-02-PLAN.md — Unit detail view: router extension, state extension, invoice history, PM schedule, condition tracking
- [x] 04-03-PLAN.md — Browser verification checkpoint (human-verify unit detail page)

### Phase 5: Dashboard
**Goal**: Users open the app and immediately see what needs attention — no navigation required
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02
**Success Criteria** (what must be TRUE):
  1. The main screen shows overdue and due-soon maintenance items without any tapping or filtering
  2. A unit list with at-a-glance status (ok / due soon / overdue) is visible on the main screen
  3. Tapping any item on the dashboard navigates directly to that unit's detail page
**Plans:** 1/1 plans complete

Plans:
- [x] 05-01-PLAN.md — Dashboard view with overdue/due-soon alerts and unit status grid, wired as default route

### Phase 6: Auth Hardening and PWA Reliability
**Goal**: The app works reliably in the field — no mid-upload auth failures, no data loss on reconnect, and installs cleanly on phones
**Depends on**: Phase 5
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. A user who leaves the app open for over an hour can still upload without being interrupted by an auth error
  2. An upload started while offline is queued and automatically retried when the connection is restored
  3. The app prompts users to install it to the Home Screen on both iOS and Android, and once installed behaves as a standalone app
**Plans:** 3/3 plans complete

Plans:
- [ ] 06-01-PLAN.md — Silent token refresh: offline_access scope, refreshAccessToken, getValidToken, wire all API callers
- [ ] 06-02-PLAN.md — PWA install prompt: fix manifest.json paths, iOS/Android install banners, SW cache update
- [ ] 06-03-PLAN.md — Offline upload queue: IndexedDB queue, offline guard in upload form, online event drain

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/3 | Complete    | 2026-03-17 |
| 2. Scanner and OCR | 3/3 | Complete    | 2026-03-17 |
| 3. Invoice Workflow | 0/3 | Complete    | 2026-03-17 |
| 4. Maintenance Tracking | 3/3 | Complete    | 2026-03-17 |
| 5. Dashboard | 1/1 | Complete    | 2026-03-17 |
| 6. Auth Hardening and PWA Reliability | 1/3 | Complete    | 2026-03-17 |
| 7. Dashboard & UX Improvements | 0/4 | Complete    | 2026-03-19 |
| 8. Claude Vision Invoice Extraction | 1/3 | In Progress|  |

### Phase 7: Dashboard & UX Improvements

**Goal:** The dashboard and unit detail pages are polished, dark-mode-ready, and feature-complete — with fleet summary, search, edit/delete units, working PDF links, and proper loading/empty states
**Depends on:** Phase 6
**Requirements:** B4, B5, B6, B7, B8, C9, C10, C11, C12, C13, D14, D15, D16, D17
**Success Criteria** (what must be TRUE):
  1. Fleet summary bar shows total units, overdue count, and fleet-wide stats above category tabs
  2. Milestone rows on cards use color (red/green) not just emoji for overdue/ok
  3. Dashboard has a search bar that filters units by ID and a status filter
  4. Action items filter to match the active category tab
  5. Add Unit form collects all unit attributes (VIN, Plate, Make, Model, Year, DotExpiry)
  6. Unit detail page uses CSS classes with design tokens — no hardcoded hex colors, works in dark mode
  7. Loading states show skeleton placeholders instead of plain text
  8. Category tab scrollbar is hidden on Android
  9. Back links have tap feedback and a chevron icon
  10. Empty states have icons and call-to-action buttons
  11. Unit attributes are editable from the unit detail page
  12. Units can be deleted from the roster
  13. Mileage can be updated directly from the dashboard card without opening unit detail
  14. Invoice PDF links open correctly with authentication
**Plans:** 4/4 plans complete

Plans:
- [ ] 07-01-PLAN.md — CSS/visual foundation: dark mode fix, skeletons, scrollbar, back links, empty states, color-coded milestones
- [ ] 07-02-PLAN.md — Dashboard UX: fleet summary bar, search/filter, tab-filtered action items, quick mileage update
- [ ] 07-03-PLAN.md — Unit CRUD: expanded add form, edit attributes, delete unit with CSV cleanup
- [ ] 07-04-PLAN.md — Invoice PDF fix: authenticated blob fetch for PDF links

### Phase 8: Claude Vision Invoice Extraction

**Goal:** Invoice extraction is powered by Claude Haiku 4.5 Vision — one API call per invoice extracts all metadata, auto-fills the form, detects maintenance milestones, and resets them on upload
**Depends on:** Phase 7
**Requirements:** VIS-01, VIS-02, VIS-03, VIS-04, VIS-05, VIS-06, VIS-07
**Success Criteria** (what must be TRUE):
  1. A scanned or uploaded invoice triggers a Claude Haiku extraction that returns unit number, date, vendor, cost, invoice number, summary, line items, and detected milestones
  2. Extracted fields auto-fill the upload form (unit, date, cost, vendor, invoice number)
  3. Summary and line items are displayed for user review
  4. A milestone tag picker shows AI-detected milestones pre-selected; user can toggle before upload
  5. On upload, selected milestones are batch-reset in maintenance.csv with a single write
  6. Both camera scans (JPEG) and uploaded PDFs are supported for extraction
  7. Tesseract.js and all spatial scoring code are removed
**Plans:** 1/3 plans executed

Plans:
- [ ] 08-01-PLAN.md — Worker rename + /extract-invoice POST route with Claude Haiku API
- [ ] 08-02-PLAN.md — Extract client module, upload.js rewire, Tesseract removal
- [ ] 08-03-PLAN.md — Milestone tag picker UI, batch milestone reset, SW/URL cleanup

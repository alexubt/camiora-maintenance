# Roadmap: Camiora Fleet Maintenance PWA

## Overview

This roadmap transforms the existing working PWA skeleton (auth, upload, scanner) into a production-quality fleet maintenance tool. Phase 1 breaks the monolith and establishes the CSV data layer that every feature depends on. Phase 2 polishes the scanner and adds OCR auto-fill. Phase 3 closes the complete invoice workflow end-to-end. Phase 4 adds maintenance tracking. Phase 5 delivers the action-focused dashboard. Phase 6 hardens auth and PWA reliability before distribution.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - ES module refactor and CSV data layer (unit roster, optimistic locking) (completed 2026-03-17)
- [ ] **Phase 2: Scanner and OCR** - Production-quality scanner with deskew, B&W, and OCR auto-fill
- [ ] **Phase 3: Invoice Workflow** - Complete end-to-end invoice capture, naming, upload, and record
- [ ] **Phase 4: Maintenance Tracking** - Per-unit PM schedules, overdue alerts, condition data, unit detail pages
- [ ] **Phase 5: Dashboard** - Action-focused main screen showing what needs attention now
- [ ] **Phase 6: Auth Hardening and PWA Reliability** - Silent token refresh, Home Screen install, offline queue

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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

### Phase 5: Dashboard
**Goal**: Users open the app and immediately see what needs attention — no navigation required
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02
**Success Criteria** (what must be TRUE):
  1. The main screen shows overdue and due-soon maintenance items without any tapping or filtering
  2. A unit list with at-a-glance status (ok / due soon / overdue) is visible on the main screen
  3. Tapping any item on the dashboard navigates directly to that unit's detail page
**Plans**: TBD

### Phase 6: Auth Hardening and PWA Reliability
**Goal**: The app works reliably in the field — no mid-upload auth failures, no data loss on reconnect, and installs cleanly on phones
**Depends on**: Phase 5
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. A user who leaves the app open for over an hour can still upload without being interrupted by an auth error
  2. An upload started while offline is queued and automatically retried when the connection is restored
  3. The app prompts users to install it to the Home Screen on both iOS and Android, and once installed behaves as a standalone app
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/3 | Complete    | 2026-03-17 |
| 2. Scanner and OCR | 0/TBD | Not started | - |
| 3. Invoice Workflow | 0/TBD | Not started | - |
| 4. Maintenance Tracking | 0/TBD | Not started | - |
| 5. Dashboard | 0/TBD | Not started | - |
| 6. Auth Hardening and PWA Reliability | 0/TBD | Not started | - |

# Requirements: Camiora Fleet Maintenance PWA

**Defined:** 2026-03-16
**Core Value:** Streamline invoice upload to save hundreds of hours of manual data entry and categorization

## v1 Requirements

### Scanner

- [x] **SCAN-01**: Image is converted to B&W with high contrast to look like a scanned document
- [x] **SCAN-02**: Crooked photos are automatically deskewed/straightened
- [x] **SCAN-03**: Canvas memory is released after processing to prevent iOS crashes
- [x] **SCAN-04**: jsPDF upgraded to 4.2.0 (security fix + better encoding)

### OCR

- [x] **OCR-01**: Tesseract.js extracts text from scanned invoice image
- [x] **OCR-02**: OCR auto-fills unit number, date, and maintenance type from extracted text
- [x] **OCR-03**: User can confirm or correct OCR-detected fields before upload

### Invoice Upload

- [x] **INV-01**: User can select truck/trailer unit from fleet CSV data
- [x] **INV-02**: User can select invoice date via date picker
- [x] **INV-03**: User can select maintenance type from presets or enter custom type
- [x] **INV-04**: File is auto-named as `UNIT_DATE_TYPE.pdf`
- [x] **INV-05**: PDF uploads to per-unit OneDrive folder (`/Fleet/UNIT/Invoices/`)
- [x] **INV-06**: Invoice record is appended to fleet CSV after upload (date, type, cost, PDF link)

### Fleet Data

- [x] **FLEET-01**: Unit roster loaded from CSV on OneDrive (trucks and trailers)
- [ ] **FLEET-02**: Per-unit invoice history (date, vendor, cost, type — linked to PDFs)
- [x] **FLEET-03**: Scheduled maintenance tracking with intervals and due dates
- [x] **FLEET-04**: Overdue maintenance alerts
- [ ] **FLEET-05**: Unit condition tracking (mileage/hours, DOT inspection status, tire data)
- [ ] **FLEET-06**: Unit detail page showing full history and condition
- [x] **FLEET-07**: CSV optimistic locking (hash-check before write, diff-merge changes)

### Dashboard

- [ ] **DASH-01**: Action-focused main screen showing overdue and upcoming maintenance
- [ ] **DASH-02**: Unit list with status at a glance

### Infrastructure

- [ ] **INFRA-01**: Home Screen install prompt for iOS/Android
- [ ] **INFRA-02**: Silent token refresh (no re-login interruption after 1 hour)
- [ ] **INFRA-03**: Offline queue for uploads, sync when reconnected
- [x] **INFRA-04**: ES module refactor of existing monolith `app.js`

## v2 Requirements

### Advanced Scanner

- **SCAN-05**: OpenCV.js perspective correction (if Canvas deskew proves insufficient)
- **SCAN-06**: Multi-page invoice scanning (combine multiple photos into one PDF)

### Reporting

- **RPT-01**: Monthly maintenance cost summary per unit
- **RPT-02**: Export maintenance report as PDF
- **RPT-03**: Fleet-wide cost analytics

### Notifications

- **NOTF-01**: Push notifications for overdue maintenance
- **NOTF-02**: Email reminders for upcoming scheduled maintenance

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native mobile app | PWA covers iOS/Android adequately |
| Backend server | GitHub Pages constraint; OneDrive is the data layer |
| GPS/telematics tracking | Requires hardware + backend, both out of scope |
| AI/predictive maintenance | No telematics data to predict from; interval-based scheduling fits |
| Multi-tenant/multi-company | Internal tool for KINGPIN only |
| Driver self-service portal | Fleet department use only |
| Real-time collaboration | Small team, optimistic locking sufficient |
| Graph Excel API | CSV approach is simpler, avoids session/concurrency complexity |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-04 | Phase 1 | Complete |
| FLEET-01 | Phase 1 | Complete |
| FLEET-07 | Phase 1 | Complete |
| SCAN-01 | Phase 2 | Complete |
| SCAN-02 | Phase 2 | Complete |
| SCAN-03 | Phase 2 | Complete |
| SCAN-04 | Phase 2 | Complete |
| OCR-01 | Phase 2 | Complete |
| OCR-02 | Phase 2 | Complete |
| OCR-03 | Phase 2 | Complete |
| INV-01 | Phase 3 | Complete |
| INV-02 | Phase 3 | Complete |
| INV-03 | Phase 3 | Complete |
| INV-04 | Phase 3 | Complete |
| INV-05 | Phase 3 | Complete |
| INV-06 | Phase 3 | Complete |
| FLEET-02 | Phase 4 | Pending |
| FLEET-03 | Phase 4 | Complete |
| FLEET-04 | Phase 4 | Complete |
| FLEET-05 | Phase 4 | Pending |
| FLEET-06 | Phase 4 | Pending |
| DASH-01 | Phase 5 | Pending |
| DASH-02 | Phase 5 | Pending |
| INFRA-01 | Phase 6 | Pending |
| INFRA-02 | Phase 6 | Pending |
| INFRA-03 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-16 after roadmap creation — all requirements mapped*

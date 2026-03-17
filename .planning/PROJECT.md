# Camiora — Fleet Maintenance PWA

## What This Is

A mobile-first Progressive Web App for KINGPIN Trucking's fleet department that streamlines maintenance invoice uploading to OneDrive. Users snap a photo of an invoice, select the truck/trailer unit, date, and maintenance type, and the app auto-names the file and uploads it to the correct OneDrive folder. Beyond invoices, it serves as a lightweight fleet maintenance hub — tracking unit condition, scheduled maintenance, and surfacing what needs attention.

## Core Value

Streamline invoice upload to save hundreds of hours of manual data entry and categorization. Snap, categorize, auto-file — invoices land in the right OneDrive folder with the right name, every time.

## Requirements

### Validated

- ✓ Microsoft OAuth (PKCE) authentication — existing
- ✓ OneDrive file upload — existing
- ✓ Document scanner with camera capture — existing
- ✓ PDF generation from photos — existing (needs quality improvements)
- ✓ PWA with service worker — existing
- ✓ GitHub Pages hosting — existing

### Active

- [ ] Deskew captured images to straighten crooked photos
- [ ] B&W filter to make photos look like scanned documents
- [ ] Reduce PDF file size (~500KB target)
- [ ] Unit selection (trucks and trailers) from a shared data source
- [ ] Date picker for invoice date
- [ ] Maintenance type selection with preset categories + custom types
- [ ] Auto-naming: `UNIT_DATE_TYPE.pdf` format (e.g. `TRK-1234_2026-03-16_OilChange.pdf`)
- [ ] Upload to per-unit OneDrive folders (e.g. `/Fleet/TRK-1234/Invoices/`)
- [ ] Excel/CSV file on OneDrive as shared fleet database (read/write)
- [ ] Invoice history per unit (date, vendor, cost, type — linked to uploaded PDFs)
- [ ] Scheduled maintenance tracking (oil changes, inspections, tires — with due dates/intervals)
- [ ] Unit condition data (mileage/hours, DOT inspection status, tire tracking)
- [ ] Action-focused dashboard (what's due, what's overdue, what needs attention)
- [ ] Unit detail pages (full history, condition, upcoming maintenance)
- [ ] Works on iOS and Android mobile browsers

### Out of Scope

- Native mobile app — PWA covers iOS/Android
- Backend server — everything runs client-side with OneDrive as storage
- Multi-tenant / multi-company — internal tool for KINGPIN only
- Real-time collaboration — Excel on OneDrive handles concurrent access
- Driver self-service portal — fleet department use only (small team)

## Context

- This is an internal tool for KINGPIN Trucking's fleet department (small team)
- Currently hosted on GitHub Pages as a static PWA
- All data lives on OneDrive (invoices as PDFs, fleet data as Excel/CSV)
- Microsoft Graph API handles auth and file operations (PKCE flow already working)
- The existing scanner/PDF pipeline works but produces poor quality output — deskewing and B&W filtering are the immediate pain points
- The app is used in the field on phones — mobile-first UX is critical
- Maintenance types need to be flexible: common presets (oil change, tires, brakes, DOT inspection) plus ability to add custom types

## Constraints

- **Hosting**: GitHub Pages — static files only, no server-side processing
- **Storage**: OneDrive via Microsoft Graph API — no separate database
- **Auth**: Microsoft OAuth PKCE — already implemented, must preserve
- **Platform**: PWA — must work on iOS Safari and Android Chrome
- **Processing**: All image/PDF processing happens client-side in the browser
- **Data**: Excel/CSV on OneDrive serves as the database — must handle read/write via Graph API

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Excel on OneDrive as database | No backend needed, fleet team already uses Excel, stays in Microsoft ecosystem | — Pending |
| Per-unit folder structure on OneDrive | Matches how fleet dept thinks about vehicles, easy to browse manually | — Pending |
| Flexible maintenance categories | Fleet needs change, can't predict all repair types upfront | — Pending |
| Client-side image processing | GitHub Pages constraint, no server available | — Pending |
| `UNIT_DATE_TYPE.pdf` naming | Unit-first for easy browsing within OneDrive folders | — Pending |

---
*Last updated: 2026-03-16 after initialization*

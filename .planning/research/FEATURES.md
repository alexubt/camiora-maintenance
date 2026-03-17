# Feature Research

**Domain:** Lightweight internal fleet maintenance PWA (trucking, small team)
**Researched:** 2026-03-16
**Confidence:** MEDIUM — industry feature sets verified via multiple current sources; internal-tool priorities inferred from project constraints (no server, OneDrive storage, small team)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the fleet department will assume exist from day one. Missing any of these makes the tool feel broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Unit list (trucks + trailers) | Users need a roster to attach any record to | LOW | Read from shared Excel/CSV on OneDrive; units don't change often |
| Invoice capture and upload | The existing core workflow — still must work perfectly | MEDIUM | Camera capture + PDF generation already exists; deskew/B&W polish needed |
| Per-unit invoice history | Users expect to pull up a truck and see what was spent | MEDIUM | Read invoice folder listing from OneDrive Graph API; surface metadata from filename |
| Auto-file naming (UNIT_DATE_TYPE) | Manual naming is the current pain point being solved | LOW | Pure string formatting; filename encodes the record |
| Upload to per-unit OneDrive folder | Files must land in the right place automatically | LOW | OneDrive path construction from unit + date + type |
| Maintenance type selection (presets + custom) | Common repairs need fast selection; edge cases exist | LOW | Static list + "Other / custom" text field; stored in Excel |
| Scheduled maintenance tracking | Every fleet tool tracks when PM is due | MEDIUM | Interval-based (mileage or time) + fixed date; requires unit mileage data |
| Overdue maintenance alerts | Missed PM is the #1 fleet failure mode | LOW | Calculated at read time from schedule + last-performed date; no push needed |
| Dashboard: what needs attention now | First screen users open; must show problems at a glance | MEDIUM | Filtered view of overdue + due-soon items across all units |
| Unit detail page | Fleet managers need a single-unit view: history, condition, upcoming | MEDIUM | Aggregates invoice history + PM schedule + condition data per unit |
| DOT inspection status per unit | Annual DOT inspection is a hard legal compliance requirement | LOW | Date field + expiry calculation (12-month interval); show status badge |
| Mileage / odometer tracking | Required to calculate mileage-based PM intervals | LOW | Entered at invoice time or as standalone update; stored in Excel |
| Works on iOS Safari and Android Chrome | Field use is on phones — desktop is secondary | LOW | Already a PWA constraint; test both platforms per feature |

### Differentiators (Competitive Advantage)

Features that go beyond the floor. These align with Camiora's core value: snapping an invoice in the field and having it automatically filed with context attached.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Document scanner with edge detection | Most fleet tools accept file uploads, not camera scanning — this eliminates "find the PDF" friction | HIGH | Existing but needs deskew + B&W filter polish; client-side via canvas |
| Invoice attached directly to maintenance record | Competitors store invoices and maintenance records separately; linking them creates a full audit trail | MEDIUM | Filename-as-record means the PDF *is* the record; history view reads OneDrive folder |
| Zero-server architecture (OneDrive as database) | No SaaS subscription, no data outside Microsoft, no infrastructure to maintain | HIGH | Excel/CSV on OneDrive via Graph API; biggest technical risk is concurrent write handling |
| Offline-capable capture (PWA service worker) | Field use happens in shops with poor connectivity | MEDIUM | Service worker exists; need upload queue for when connectivity returns |
| Action-focused dashboard (not reporting) | Most fleet tools lead with charts and reports; this tool leads with "what needs doing today" | LOW | Design decision: surface overdue/due-soon items, not historical KPIs |
| Flexible maintenance categories | Rigid category lists break when fleet needs change; custom types prevent workarounds | LOW | Preset list + custom input; categories stored in shared Excel |
| Tire tracking per unit | Tire condition and rotation is a frequent, safety-critical PM item in trucking | MEDIUM | Track last rotation mileage + condition notes; flag when rotation interval exceeded |

### Anti-Features (Commonly Requested, Often Problematic)

Features that sound useful but would exceed the tool's constraints or dilute its focus.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| GPS / real-time vehicle tracking | Fleets want to know where trucks are | Requires telematics hardware, backend server, live data pipeline — incompatible with static PWA + OneDrive constraint | Out of scope; use a dedicated telematics platform (Samsara, Geotab) |
| AI-powered predictive maintenance | Industry trend; sounds like a differentiator | Requires sensor telemetry data and an ML backend; without telematics data, AI has nothing to predict | Use simple interval-based scheduling — equally effective for a manually-maintained fleet |
| Driver portal / driver self-service | Drivers could report defects directly | Out of scope per PROJECT.md; drivers are not the user; adds auth complexity and a second user model | Fleet staff logs defects on drivers' behalf |
| Push notifications / service worker alerts | "Alert me when PM is due" | iOS Safari restricts PWA push notifications; unreliable cross-platform; creates notification fatigue | Dashboard badge + overdue count is sufficient for a small team checking the app daily |
| Full work order management (assign to tech, labor hours, parts inventory) | Enterprise fleet tools have this | Over-engineering for a small internal team; adds a workflow layer nobody will maintain | Keep it simple: invoice upload is the "work order closed" signal |
| Parts inventory / procurement | Fleet managers track parts consumption | Requires a separate inventory data model, reorder logic, supplier integrations — far beyond OneDrive/Excel scope | Log parts costs in invoice record; no dedicated inventory module |
| Fuel management / fuel card integration | Fuel is a major cost center | Fuel tracking requires integration with fuel card providers (WEX, Comdata) or manual entry at scale; not the current pain point | If needed later, add a simple fuel log entry per unit in the Excel schema |
| Multi-company / multi-tenant | Could be sold to other fleets | Violates PROJECT.md scope; adds auth model complexity, data isolation, billing | Internal tool only; KINGPIN Trucking data only |
| Reporting / analytics dashboards | Managers want utilization charts, cost per mile | Chart-heavy dashboards require significant data volume to be meaningful; small fleet's data is already readable as a list | Simple totals on unit detail page; export to Excel for analysis |

---

## Feature Dependencies

```
[Unit roster (Excel/OneDrive)]
    └──required by──> [Invoice capture + upload]
    └──required by──> [Invoice history per unit]
    └──required by──> [Scheduled maintenance tracking]
    └──required by──> [Unit detail page]
    └──required by──> [Dashboard: what needs attention]

[Mileage tracking]
    └──required by──> [Mileage-based PM interval calculation]
                          └──required by──> [Overdue maintenance alerts]

[Scheduled maintenance tracking]
    └──required by──> [Overdue maintenance alerts]
    └──required by──> [Dashboard: what needs attention]

[Invoice capture + upload]
    └──enhances──> [Invoice history per unit]
                      └──enhances──> [Unit detail page]

[DOT inspection status]
    └──feeds into──> [Dashboard: what needs attention]

[Tire tracking]
    └──feeds into──> [Unit detail page]
    └──feeds into──> [Dashboard: what needs attention]

[Document scanner (camera + PDF)]
    └──enhances──> [Invoice capture + upload]

[Offline capture queue]
    └──enhances──> [Invoice capture + upload]
```

### Dependency Notes

- **Unit roster is the root dependency.** Everything else attaches records to a unit. The Excel/CSV schema for units must be defined before any other data work begins.
- **Mileage tracking gates PM intervals.** Without current odometer data, mileage-based PM calculations (oil changes, tire rotation) are impossible. Time-based PM (DOT annual inspection) is independent.
- **Invoice capture is independent of maintenance scheduling.** They can be built in parallel once the unit roster exists, but the unit detail page and dashboard both depend on both being present.
- **Dashboard requires both maintenance tracking and overdue calculation.** It is the last feature to build — it aggregates everything else.
- **Offline queue conflicts with Excel concurrent writes.** If two users are offline and both write the same row, a merge conflict occurs. For a small team, document "last write wins" and accept it rather than building conflict resolution.

---

## MVP Definition

### Launch With (v1 — invoice workflow complete)

The existing pain point is invoice filing. v1 closes that loop end-to-end.

- [ ] Unit roster loaded from OneDrive Excel — units selectable in the upload flow
- [ ] Invoice capture: camera scan, deskew, B&W filter, PDF generation (~500KB)
- [ ] Maintenance type selection (presets + custom)
- [ ] Auto-naming: `UNIT_DATE_TYPE.pdf`
- [ ] Upload to per-unit OneDrive folder
- [ ] Invoice history per unit — read folder listing, display date/type/link

### Add After Validation (v1.x — maintenance hub)

Once invoice filing is reliable, add the tracking layer.

- [ ] Mileage entry per unit (entered when uploading an invoice or standalone)
- [ ] Scheduled maintenance setup (PM intervals per unit: oil, DOT, tires, brakes)
- [ ] Overdue maintenance alerts calculated at read time
- [ ] DOT inspection expiry per unit (date + 12-month badge)
- [ ] Unit detail page (history + schedule + condition)
- [ ] Dashboard: overdue + due-soon items across all units

### Future Consideration (v2+)

Deferred until v1.x is stable and the team has validated the data model.

- [ ] Tire tracking per unit (rotation mileage tracking, condition notes)
- [ ] Offline upload queue (service worker queues failed uploads for retry)
- [ ] Cost totals per unit (sum invoice costs from Excel rows, display on unit page)
- [ ] Fuel log entry per unit (simple odometer + gallons + cost)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Invoice capture + upload (polished) | HIGH | MEDIUM | P1 |
| Unit roster from OneDrive Excel | HIGH | MEDIUM | P1 |
| Auto-naming + per-unit folder | HIGH | LOW | P1 |
| Maintenance type (presets + custom) | HIGH | LOW | P1 |
| Invoice history per unit | HIGH | MEDIUM | P1 |
| Scheduled maintenance tracking | HIGH | MEDIUM | P2 |
| Overdue maintenance alerts | HIGH | LOW | P2 |
| DOT inspection status | HIGH | LOW | P2 |
| Unit detail page | HIGH | MEDIUM | P2 |
| Dashboard (attention-focused) | HIGH | MEDIUM | P2 |
| Mileage / odometer tracking | MEDIUM | LOW | P2 |
| Tire tracking | MEDIUM | MEDIUM | P3 |
| Offline upload queue | MEDIUM | HIGH | P3 |
| Cost totals per unit | LOW | LOW | P3 |
| Fuel log | LOW | LOW | P3 |

**Priority key:**
- P1: Must have — core invoice workflow; existing users blocked without this
- P2: Should have — maintenance hub; reason to open the app beyond invoice filing
- P3: Nice to have — extends value once core is stable

---

## Competitor Feature Analysis

Competitors surveyed: Fleetio, AUTOsist, Simply Fleet, Whip Around. All are SaaS with backends, mobile apps, and subscription pricing. Camiora's constraints produce a genuinely different profile.

| Feature | Fleetio / AUTOsist / Simply Fleet | Camiora Approach |
|---------|-----------------------------------|------------------|
| Document storage | Cloud storage, PDFs attached to work orders | PDFs uploaded directly to OneDrive; filename is the record |
| Unit management | Database-backed with custom fields | Excel on OneDrive; flexible schema, familiar to fleet staff |
| PM scheduling | Server-calculated, push alerts, email reminders | Client-calculated at read time from Excel data; no push |
| Dashboard | Charts, KPIs, utilization reports | Action list: overdue + due-soon only; no charts in v1 |
| Invoice capture | File upload or photo attach | Camera scan → deskew → B&W filter → PDF; field-first |
| Offline support | Varies; most require connectivity | PWA service worker; upload queue in v2 |
| Auth | Email/password, SSO options | Microsoft OAuth PKCE; already in Microsoft ecosystem |
| Pricing | $5–$25/vehicle/month | Internal tool; no per-seat cost |
| GPS / telematics | Core feature in most | Deliberately out of scope |

**Key differentiation:** Camiora is not trying to compete with Fleetio. It is a thin layer on top of OneDrive that eliminates manual invoice filing and surfaces maintenance obligations — for a team already living in Microsoft 365. The value is integration with existing workflows, not feature parity with SaaS fleet tools.

---

## Sources

- [12 Must Have Fleet Management Software Features in 2026](https://www.upperinc.com/blog/fleet-management-software-features/) — MEDIUM confidence (delivery-focused, not pure maintenance)
- [AUTOsist Fleet Maintenance Tool](https://autosist.com/) — HIGH confidence (direct product feature list)
- [Simply Fleet — Fleet Maintenance Software](https://www.simplyfleet.app/) — HIGH confidence (direct product feature list)
- [Trucking Software Trends 2026](https://www.avaal.com/blogs/trucking-software-trends-2026-what-fleets-must-know/) — MEDIUM confidence (market trends article)
- [Fleet Mobile App Development Feature Guide 2026](https://oxmaint.com/industries/fleet-management/fleet-mobile-app-development-complete-feature-guide-2026) — MEDIUM confidence
- [7 Key Metrics Every Fleet Manager Should Track](https://www.simplyfleet.app/blog/fleet-reporting-metrics) — MEDIUM confidence
- [Truck Fleet Maintenance: The Complete Guide](https://matrackinc.com/truck-fleet-maintenance/) — MEDIUM confidence (PM interval standards)
- [Annual DOT Inspection Ultimate Guide](https://www.ntassoc.com/annual-dot-inspection-the-ultimate-guide) — HIGH confidence (regulatory requirement)
- [Fleetio — Fleet Management Software](https://www.fleetio.com/) — HIGH confidence (direct product)

---

*Feature research for: Lightweight internal fleet maintenance PWA (KINGPIN Trucking)*
*Researched: 2026-03-16*

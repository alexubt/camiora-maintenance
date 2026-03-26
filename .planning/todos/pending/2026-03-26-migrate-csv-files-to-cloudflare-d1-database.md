---
created: 2026-03-26T21:15:53.648Z
title: Migrate CSV files to Cloudflare D1 database
area: infrastructure
files:
  - app/graph/csv.js
  - app/state.js
---

## Problem

CSV files on OneDrive require downloading the entire file, parsing it, modifying rows, and re-uploading with optimistic locking. This is slow, doesn't scale well, and creates race conditions with concurrent edits. Cloudflare D1 (SQLite at the edge) would provide proper queries, atomic writes, and much better performance.

## Solution

- Create D1 database with tables: units, maintenance, condition, invoices, milestone_config, samsara_mapping
- Add REST API routes to the Worker for CRUD operations
- Migrate `app/graph/csv.js` to call Worker API instead of Graph API
- One-time migration script to import existing CSV data into D1
- Keep OneDrive for PDF/invoice file storage only

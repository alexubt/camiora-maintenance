---
created: 2026-03-26T21:15:53.648Z
title: Scheduled Samsara mileage sync via Worker Cron
area: infrastructure
files:
  - worker/samsara-proxy.js
  - app/samsara/sync.js
---

## Problem

Currently the PWA polls Samsara every 5 minutes from the browser. This means mileage only updates when someone has the app open. A Cloudflare Worker Cron Trigger could run hourly server-side, fetch all odometers from Samsara, and write directly to condition.csv on OneDrive via Graph API — so mileage is always fresh regardless of app usage.

## Solution

- Add a Cron Trigger to the existing `camiora-samsara-proxy` Worker (e.g., `crons = ["0 * * * *"]`)
- Worker fetches Samsara `/fleet/vehicles/stats`, reads `samsara-mapping.csv` from OneDrive, computes deltas, writes `condition.csv`
- Requires storing a Graph API refresh token as a Worker secret (or using app-only auth with client credentials)
- PWA-side polling can be removed or reduced to a longer interval as a fallback

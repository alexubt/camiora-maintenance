---
created: 2026-03-26T21:15:53.648Z
title: DOT expiry reminder notifications
area: infrastructure
files:
  - worker/samsara-proxy.js
  - app/fleet/units.js
---

## Problem

DOT expirations are only visible when someone opens the dashboard. A truck's DOT could expire without anyone noticing until it's too late, risking compliance violations and fines.

## Solution

- Daily Worker Cron reads `units.csv` from OneDrive
- Checks each unit's DotExpiry against today's date
- Sends email/Slack/push notifications at 90, 60, and 30 days before expiration
- Could use Cloudflare Email Workers, a Slack webhook, or Web Push

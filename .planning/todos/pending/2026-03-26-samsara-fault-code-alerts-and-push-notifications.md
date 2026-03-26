---
created: 2026-03-26T21:15:53.648Z
title: Samsara fault code alerts and push notifications
area: infrastructure
files:
  - worker/samsara-proxy.js
  - sw.js
---

## Problem

Fleet managers currently have to check Samsara manually for fault codes and engine warnings. There's no proactive notification when a truck reports a problem. Push notifications via the PWA's service worker would deliver instant alerts.

## Solution

- Add `/vehicles/stats?types=faultCodes` route to the Worker proxy
- Worker Cron polls fault codes periodically, compares to last-known state (stored in KV)
- On new fault code: send Web Push notification via the PWA's service worker
- Requires Web Push subscription (VAPID keys), stored in Cloudflare KV
- Could also proxy Samsara webhooks for real-time alerts instead of polling

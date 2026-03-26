---
created: 2026-03-26T21:15:53.648Z
title: Weekly fleet maintenance report email
area: infrastructure
files:
  - worker/samsara-proxy.js
---

## Problem

There's no consolidated view of fleet maintenance status over time. The dashboard shows current state, but management may want a weekly summary of maintenance spend, overdue items, mileage trends, and upcoming service needs.

## Solution

- Weekly Worker Cron (e.g., Monday 8am) reads all CSVs from OneDrive
- Compiles: total spend this week, overdue milestones count, upcoming DOT expirations, mileage deltas
- Generates HTML email and sends via Cloudflare Email Workers or SMTP relay
- Could also generate a PDF report and upload to OneDrive

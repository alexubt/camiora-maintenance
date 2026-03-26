---
created: 2026-03-26T21:15:53.648Z
title: PDF receipt auto-emailer via Worker
area: infrastructure
files:
  - app/views/upload.js
  - worker/samsara-proxy.js
---

## Problem

After uploading an invoice, the fleet manager may want to automatically forward the PDF to an accountant or shared inbox. Currently this requires manually downloading from OneDrive and emailing.

## Solution

- Add a `/send-receipt` POST route to the Worker
- After successful upload in the PWA, optionally call the Worker with the PDF blob and recipient email
- Worker uses Cloudflare Email Workers or an SMTP relay (e.g., Mailgun, SendGrid) to deliver
- Configurable recipient list stored as Worker environment variable

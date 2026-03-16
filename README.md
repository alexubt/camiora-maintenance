# Camiora Maintenance PWA

Mobile-first PWA for fleet maintenance record uploads.
- **OCR**: Tesseract.js — runs 100% on-device, free, no API key
- **Auth**: Microsoft OAuth 2.0 implicit flow (M365)
- **Storage**: Microsoft Graph API → OneDrive
- **Hosting**: GitHub Pages (free)

Zero external API keys required after setup.

---

## Files

```
camiora-pwa/
├── index.html      App shell + Tesseract CDN script tag
├── app.js          Auth, OCR, OneDrive upload logic
├── style.css       Mobile-native styles, dark mode, safe areas
├── sw.js           Service worker (offline + Tesseract asset caching)
├── manifest.json   PWA manifest
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## Step 1 — Azure App Registration (5 min)

1. Go to https://portal.azure.com
2. Azure Active Directory → App registrations → New registration
3. Name: `Camiora Maintenance`
4. Supported account types: **Accounts in this organizational directory only**
5. Redirect URI: **Single-page application (SPA)**
   → `https://YOUR-USERNAME.github.io/camiora-maintenance`
6. Click Register
7. Copy **Application (client) ID** → CLIENT_ID
8. Copy **Directory (tenant) ID** → TENANT_ID
9. API permissions → Add → Microsoft Graph → Delegated:
   - `Files.ReadWrite`
   - `User.Read`
10. Grant admin consent

---

## Step 2 — Edit CONFIG in app.js

Open `app.js` and fill in the top block:

```js
const CONFIG = {
  CLIENT_ID:     'paste-client-id',
  TENANT_ID:     'paste-tenant-id',
  REDIRECT_URI:  'https://YOUR-USERNAME.github.io/camiora-maintenance',
  ONEDRIVE_BASE: 'Fleet',
};
```

That's it. No API keys. No secrets. Safe to commit to a public GitHub repo.

---

## Step 3 — Deploy to GitHub Pages

1. Create a new GitHub repo: `camiora-maintenance`
2. Upload all files to the repo root
3. Settings → Pages → Source: Deploy from branch → main / root
4. Live at: `https://YOUR-USERNAME.github.io/camiora-maintenance`

---

## Step 4 — Install on iPhone

1. Open Safari → your GitHub Pages URL
2. Tap Share → Add to Home Screen → Add
3. App icon appears on home screen, launches full-screen

---

## Step 5 — OneDrive folder structure

The app auto-creates missing folders on first upload.
Recommended to pre-create for a clean structure:

```
Fleet/
├── Trucks/
│   ├── TR-001/Maintenance/
│   ├── TR-002/Maintenance/
│   └── ...
└── Trailers/
    ├── TL-001/Maintenance/
    └── ...
```

---

## How OCR works

Tesseract.js is an open-source OCR engine compiled to WebAssembly.
It runs entirely inside the browser — no image data ever leaves the device.

When a photo is added, it scans for:
- **Unit number** — patterns like TR-042, UNIT 42, TRUCK 7
- **Date** — MM/DD/YYYY, YYYY-MM-DD, written months
- **Mileage** — odometer readings near keywords like "miles", "odo", "mileage"

Fields are auto-filled if found. Staff can correct before uploading.

First OCR run downloads the English language model (~10MB) and caches it
via the service worker for instant offline use afterward.

---

## File naming convention

`{PREFIX}-{UNIT}_{SERVICE}_{DATE}_{MILEAGE}mi[-N].{ext}`

Examples:
- `TR-042_oil-change_2026-03-16_124500mi.jpg`
- `TL-007_dot-inspection_2026-03-10.pdf`
- `TR-015_pm-service_2026-03-12_98200mi-2.jpg`  ← page 2 of multi-page scan

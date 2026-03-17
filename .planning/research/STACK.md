# Stack Research

**Domain:** Mobile-first fleet maintenance PWA — client-side image processing, Excel/OneDrive data layer, dashboard UI
**Researched:** 2026-03-16
**Confidence:** MEDIUM-HIGH (Graph API Excel limits verified from official docs; image processing from multiple sources; jsPDF version confirmed from GitHub releases)

---

## Context: What Already Exists

The codebase is brownfield vanilla JS — no build step, no npm, CDN-only dependencies. All additions must maintain that constraint unless a build step is explicitly introduced. The existing stack is:

- Vanilla JS (ES2020+) with DOM APIs
- jsPDF 2.5.2 via CDN (OUTDATED — 4.2.0 is current, 2.x has known PNG encoding regressions fixed in 3.x+)
- Canvas API for image manipulation (already used for edge detection and perspective warp)
- Microsoft Graph API via raw Fetch for auth and OneDrive upload
- Service Worker for offline caching

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| jsPDF | 4.2.0 | PDF generation from canvas images | Active maintenance, security patches, fixes PNG encoding regressions present in 2.x. Already in use — upgrade is a drop-in for UMD CDN load. |
| SheetJS (xlsx) | 0.20.3 | Parse and write Excel .xlsx files client-side | The only browser-native Excel library that works without a server. Reads ArrayBuffer directly from a Graph API download response. No license issues for internal tools. CDN-available. |
| Canvas API (built-in) | Web API | B&W filter, grayscale threshold, contrast boost | Already used in the codebase. Sufficient for document B&W filter without any additional dependency. `ctx.filter = "grayscale(1) contrast(1.5)"` plus manual threshold via `getImageData()` covers 100% of the scan quality use case. |
| Microsoft Graph Excel REST API | v1.0 | Read/write Excel workbook cells on OneDrive | Native to the Microsoft ecosystem. Requires only the existing Fetch + Bearer token setup. Works with OneDrive for Business (which KINGPIN uses via Microsoft 365). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| OpenCV.js (@techstark/opencv-js) | 4.12.0-release.1 | Perspective transform / deskew using `getPerspectiveTransform` + `warpPerspective` | **Only if** the existing Canvas-based perspective warp produces unacceptable quality. OpenCV.js is 7–8 MB; load lazily on demand only. The existing app already implements perspective warp — evaluate quality before reaching for OpenCV. |
| perspective-transform (jlouthan) | 1.1.0 | Lightweight homography matrix for quad-to-rect perspective correction | Use instead of OpenCV.js if a pure-math perspective correction is needed. ~3KB, no WASM, no loading delay. Good drop-in if the current Canvas warp has edge artifacts. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| None (no build step) | Existing constraint | Adding a build step (Vite, esbuild) would enable tree-shaking and proper npm installs, but is out of scope unless the project explicitly decides to modernize the build. |
| Browser DevTools | Performance profiling for Canvas image processing | Use the Performance tab to measure filter time on mid-range Android. Target: image processing under 300ms. |

---

## Installation

Since the project uses CDN-only loading, the "install" is updating the `<script>` tags in `index.html` and the Service Worker cache list.

```html
<!-- Upgrade jsPDF from 2.5.2 to 4.2.0 -->
<script src="https://cdn.jsdelivr.net/npm/jspdf@4.2.0/dist/jspdf.umd.min.js"></script>

<!-- Add SheetJS for Excel read/write -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>

<!-- OpenCV.js — load lazily, only on scanner screen, only if needed -->
<!-- Do NOT add to the default app load. Load dynamically: -->
<!-- const script = document.createElement('script'); -->
<!-- script.src = 'https://docs.opencv.org/4.12.0/opencv.js'; -->
<!-- script.async = true; document.body.appendChild(script); -->
```

Update `sw.js` to cache SheetJS and the new jsPDF CDN URL. Do NOT pre-cache OpenCV.js — it is 7–8 MB and will destroy offline install time.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| SheetJS for client-side Excel | Microsoft Graph Excel REST API (cell-level) | Use Graph API if you only need to append rows and never need to read the whole file client-side. Graph API cell writes are simpler (no parsing needed) but require a workbook session and fail on personal OneDrive accounts. |
| Canvas API for B&W filter | OpenCV.js for filtering | Only if you need adaptive thresholding (Sauvola/Niblack) for documents with uneven lighting. Canvas manual threshold with a tuned value (e.g. 128 or adaptive 3x3 neighborhood) is sufficient for invoice photos. |
| perspective-transform (~3KB) for deskew math | OpenCV.js `warpPerspective` | Use OpenCV only if sub-pixel accuracy and lens distortion correction are needed. For invoice deskewing, `perspective-transform` is accurate enough and doesn't cost 8 MB. |
| jsPDF 4.2.0 | pdf-lib | pdf-lib is better for modifying existing PDFs. jsPDF is better for generating new PDFs from canvas — which is what this app does. Stick with jsPDF. |
| Vanilla JS + CSS custom properties | React / Vue / Svelte | Frameworks add 30–100 KB+ and a build step. The app is a single-purpose internal tool. The cost is not justified. Only adopt a framework if the dashboard becomes complex enough to need component-level state management. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| OpenCV.js in the initial page load | 7–8 MB payload destroys first-load performance on mobile networks. PWA install takes too long and exceeds Service Worker cache budgets. | Lazy-load on demand; or use the existing Canvas API + `perspective-transform` for deskew |
| Microsoft Graph Excel REST API for primary data reads | **Does not work on personal OneDrive** (consumer accounts). Only works on OneDrive for Business / SharePoint. Race conditions on concurrent sessions. Sessions expire in 5–7 min. Cell-level API is complex for reads spanning multiple rows. | Download the .xlsx file via Graph Files API, parse client-side with SheetJS |
| ExcelJS | Designed for Node.js. Partial browser support requires bundler and polyfills. Heavy (~1 MB). Adds build complexity. | SheetJS — same Excel support, true browser-first, CDN-loadable |
| Tesseract.js | OCR was already removed from this project (commit ae67a4c). Do not re-introduce. 4 MB WASM, requires worker. Not needed for invoice scanning. | — |
| jsPDF 2.5.2 (current in-use version) | Known PNG encoding regressions, pre-dates security fixes for PDF injection and GIF dimension parsing (CVE-2025-68428). | Upgrade to jsPDF 4.2.0 |
| CSS frameworks (Bootstrap, Tailwind CDN) | Tailwind CDN (Play CDN) is flagged as not for production use. Bootstrap adds ~30KB unused CSS. Mobile-first layout with CSS Grid and custom properties is already in the codebase. | CSS Grid + custom properties (already in use) |

---

## Stack Patterns by Variant

**For Excel data layer (recommended approach):**
- Download the .xlsx file using Graph Files API (`GET /me/drive/items/{id}/content`)
- Parse with SheetJS: `XLSX.read(await response.arrayBuffer())`
- Mutate in-memory JS objects
- Serialize back: `XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })`
- Re-upload as binary via Graph Files API (`PUT /me/drive/items/{id}/content`)
- This approach works on both OneDrive Business and avoids the Excel REST API session complexity

**For Excel data layer (simpler but limited alternative):**
- Use Graph Excel REST API cell-level writes
- Only viable if: OneDrive for Business confirmed, small datasets, no concurrent users
- Pattern: `POST /me/drive/items/{id}/workbook/worksheets/{sheet}/tables/{table}/rows`
- Requires session management and handles 423 Locked errors

**For B&W document filter (no new dependency):**
- Use `ctx.filter = "grayscale(1) contrast(1.8)"` for a fast GPU-accelerated pass
- Then `getImageData()` + manual threshold loop for bitonal output
- Apply before jsPDF `addImage()` to reduce JPEG size
- This is already 90% implemented in the codebase — wire it in

**For perspective deskew (minimal dependency):**
- If the current Canvas warp is sufficient: keep it, tune the corner detection
- If quality is inadequate: add `perspective-transform` (3KB, no WASM)
- If sub-pixel accuracy is required: lazy-load OpenCV.js only on the scanner screen

**For mobile-first dashboard UI:**
- CSS Grid for card layout (`grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`)
- CSS custom properties already in use — extend the existing design system
- Sticky action bar at bottom (safe-area-inset for iPhone notch)
- No framework needed

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| jsPDF@4.2.0 | SheetJS@0.20.3 | No shared dependencies. Both are UMD globals, no conflicts. |
| jsPDF@4.2.0 | jsPDF@2.5.2 | Do NOT load both. The global `window.jspdf` would be overwritten. Replace entirely. |
| SheetJS@0.20.3 | Service Worker caching | Cache the CDN URL in `sw.js`. SheetJS CDN is stable at versioned URLs. |
| OpenCV.js@4.12.0 | Canvas API | OpenCV uses its own internal canvas-like Mat objects. Convert with `cv.matFromImageData()` and back with `cv.imshow()`. |

---

## Critical Constraint: OneDrive Account Type

**Confirmed from official Microsoft docs and community reports (2024–2025):** The Excel workbook REST API (`/workbook/worksheets/{id}/range`) does NOT work on personal/consumer OneDrive accounts. It only works on OneDrive for Business (Microsoft 365) and SharePoint.

KINGPIN Trucking uses Microsoft 365 (confirmed by PKCE auth with organizational tenant). This means the Graph Excel cell API is technically available. However, the download-parse-upload pattern via SheetJS is more robust, avoids session management, and handles the case where a user has the file open in Excel simultaneously (the download succeeds even when the file is locked for editing via the web API).

**Recommendation:** Use SheetJS download/parse/upload as the primary pattern. Use Graph Excel cell API only for single-row appends where downloading the whole file is wasteful.

---

## Sources

- [jsPDF GitHub Releases](https://github.com/parallax/jsPDF/releases) — version 4.2.0 confirmed, security advisory CVE-2025-68428
- [SheetJS Standalone Installation Docs](https://docs.sheetjs.com/docs/getting-started/installation/standalone/) — version 0.20.3, CDN URL confirmed
- [SheetJS HTTP Downloads Demo](https://docs.sheetjs.com/docs/demos/net/network/) — ArrayBuffer pattern for fetch + parse
- [Microsoft Graph Excel API Overview](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0) — .xlsx only, OneDrive for Business only
- [Microsoft Graph Excel Write Guide](https://learn.microsoft.com/en-us/graph/excel-write-to-workbook) — PATCH/POST patterns for cell writes
- [Microsoft Graph Excel Best Practices](https://learn.microsoft.com/en-us/graph/workbook-best-practice) — session management, concurrency warnings
- [Microsoft Graph Excel Sessions](https://learn.microsoft.com/en-us/graph/excel-manage-sessions) — 5-min inactivity expiry confirmed
- [OpenCV.js Smart Document Scanning](https://opencv.org/blog/smart-document-scanning-with-live-ocr-using-opencv-js/) — getPerspectiveTransform + warpPerspective pattern
- [@techstark/opencv-js npm](https://www.npmjs.com/package/@techstark/opencv-js) — version 4.12.0-release.1, confirmed browser-compatible
- [OpenCV.js file size discussion](https://answers.opencv.org/question/209264/opencvjs-smaller-package/) — 7–8 MB confirmed, lazy load required
- [perspective-transform GitHub](https://github.com/jlouthan/perspective-transform) — lightweight homography alternative
- [MDN Canvas filter property](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter) — grayscale/contrast CSS filter on canvas
- [jsPDF compression guide](https://copyprogramming.com/howto/jspdf-reduce-file-size) — JPEG + FAST compression achieves 500KB target
- [Workbook Excel API for personal OneDrive not working](https://learn.microsoft.com/en-us/answers/questions/1691489/workbook-excel-api-for-personal-onedrive-accounts) — personal OneDrive limitation confirmed 2024

---

*Stack research for: Camiora fleet maintenance PWA — image processing, Excel data layer, fleet dashboard*
*Researched: 2026-03-16*

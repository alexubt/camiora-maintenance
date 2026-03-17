# Technology Stack

**Analysis Date:** 2026-03-16

## Languages

**Primary:**
- JavaScript (ES2020+) - All application logic, client-side rendering, service worker
- HTML5 - App shell and markup
- CSS3 - Styling with custom properties (CSS variables), dark mode support

## Runtime

**Environment:**
- Web Browser (modern, with Web Workers and Service Worker support)
- Platform: Progressive Web App (PWA) targeting mobile (iOS, Android) and desktop

**Package Manager:**
- None - Zero npm/package.json dependencies. All external libraries loaded via CDN.

## Frameworks

**Core:**
- Vanilla JavaScript (DOM manipulation via `document` API)
- Web APIs: Fetch, Canvas, WebWorker (implicit), Web Crypto, IndexedDB (potential via service worker)

**PDF Generation:**
- jsPDF 2.5.2 (via CDN: `https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js`)
  - Purpose: Convert canvas images to PDF documents
  - Format: UMD bundled, loaded globally as `window.jspdf`

**PWA:**
- Service Worker (`sw.js`) - Offline-first caching strategy
- Web App Manifest (`manifest.json`) - App metadata and icons

## Key Dependencies

**Critical:**
- jsPDF 2.5.2 - Generates PDF files from scanned canvas images. Used in `buildPdfFromPages()` at `app.js:668-705`

**Infrastructure:**
- Web APIs (no external packages):
  - Fetch API - HTTP requests to Microsoft Graph and OAuth endpoints
  - Canvas API - Image processing, edge detection, perspective warp
  - Web Crypto API - PKCE challenge/verifier generation (SHA-256 hashing)
  - Service Worker API - Offline caching and asset management

## Configuration

**Environment:**
- Configuration constants in `app.js:1-7` (CONFIG object):
  - `CLIENT_ID`: Azure AD application ID
  - `TENANT_ID`: Azure AD tenant ID (set to "common" for multi-tenant)
  - `REDIRECT_URI`: GitHub Pages deployment URL
  - `ONEDRIVE_BASE`: OneDrive folder path for storage (default: "Fleet Maintenance")

**Build:**
- No build step. Static files served directly.
- Manual configuration edit required in `app.js` before deployment

**Caching Strategy:**
- Service Worker cache: `camiora-v3` (defined in `sw.js:1`)
- Static assets cached on install: HTML, JS, CSS, manifest, icons
- Network-first for CDN assets (jsPDF, etc.)
- Cache-first for local assets
- Never caches navigation requests (auth flow pass-through)

## Platform Requirements

**Development:**
- Code editor (any text editor, e.g., VS Code)
- Git for version control
- No build tools, linting, or test runners required
- Local web server optional (for live testing)

**Production:**
- GitHub Pages hosting (specified in README.md step 3)
- HTTPS support (provided by GitHub Pages)
- Browser support:
  - iOS Safari 13+ (PWA manifest, service workers, Web Crypto)
  - Android Chrome 50+ (service workers, canvas, crypto)
  - Modern desktop browsers (Edge, Chrome, Firefox, Safari)

**Deployment:**
- Manual: Upload files to GitHub repo root
- No CI/CD pipeline configured
- Configuration must be manually edited in `app.js` before deployment

---

*Stack analysis: 2026-03-16*

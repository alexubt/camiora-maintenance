# Codebase Structure

**Analysis Date:** 2026-03-16

## Directory Layout

```
camiora-pwa/
├── .git/                  # Git repository
├── .planning/             # Planning and analysis documents (generated)
│   └── codebase/         # Codebase analysis files
├── icons/                 # PWA app icons (192x512px PNG)
├── app.js                 # Main application logic (910 lines)
├── index.html             # HTML entry point
├── manifest.json          # PWA manifest
├── style.css              # Styling (10.7KB)
├── sw.js                  # Service worker (50 lines)
└── README.md              # Project documentation
```

## Directory Purposes

**icons/:**
- Purpose: PWA application icons
- Contains: PNG image assets
- Key files: `icon-192.png` (192x192), `icon-512.png` (512x512)
- Used by: `manifest.json` for app installation, browser tab display

## Key File Locations

**Entry Points:**
- `index.html`: Single HTML file, loads CSS and JavaScript, contains `<div id="app"></div>` mount point
- `sw.js`: Service worker registration target (loaded via manifest.json)
- `app.js`: Main JavaScript bundle, bootstraps at `DOMContentLoaded`

**Configuration:**
- `manifest.json`: PWA metadata (app name, icons, theme color, start URL)
- `app.js` (lines 1-8): CONFIG object with CLIENT_ID, TENANT_ID, REDIRECT_URI, ONEDRIVE_BASE

**Core Logic:**
- `app.js` (lines 19-910): All application logic in single file
  - Lines 1-8: Configuration
  - Lines 13-17: Global state variables
  - Lines 20-97: Authentication functions
  - Lines 100-117: Bootstrap/DOMContentLoaded handler
  - Lines 121-146: `renderAuth()` - login screen
  - Lines 149-299: `renderApp()` - main app UI
  - Lines 302-388: Image capture and processing pipeline
  - Lines 390-620: Image processing algorithms (blur, edge detection, perspective, threshold)
  - Lines 623-705: Scan page management and PDF building
  - Lines 708-798: File handling and form state
  - Lines 801-899: OneDrive API integration and upload

**Styling:**
- `style.css` (10.7KB): All application styles
  - CSS variables for theming (colors, spacing, typography)
  - Media query for dark mode support
  - Component styles (header, form, file list, scan pages, buttons, toast)

**Service Worker:**
- `sw.js`: Offline support and caching strategy
  - Cache version: `camiora-v3`
  - Static assets list (HTML, JS, CSS, manifest, icons)
  - Network-first for CDN (jsPDF, etc.)
  - Cache-first for app assets
  - Navigation requests never intercepted (allows OAuth redirects)

## Naming Conventions

**Files:**
- Lowercase with hyphen separators: `app.js`, `index.html`, `manifest.json`, `style.css`
- Icon filenames include dimensions: `icon-192.png`, `icon-512.png`

**Directories:**
- Lowercase: `icons/`, `.planning/`, `.git/`

**Functions:**
- camelCase: `loadToken()`, `handleCameraCapture()`, `renderApp()`
- Verb-prefixes: `get*` (getBaseName), `handle*` (handleFiles), `render*` (renderAuth), `load*` (loadImage), `process*` (processImage)
- Prefixed by layer: `ensureFolder()`, `uploadFile()` (OneDrive layer)

**Variables:**
- camelCase: `accessToken`, `scanPages`, `isUploading`, `files`
- Global app state prefixed for clarity: all-caps for constants (CONFIG, SCOPES, GRAPH, CACHE)

**DOM IDs:**
- kebab-case: `#app`, `#unitType`, `#serviceType`, `#scanZone`, `#fileList`, `#submitBtn`, `#toast`
- Descriptive: element function is clear from ID name

**CSS Classes:**
- kebab-case: `.auth-screen`, `.scan-zone`, `.file-list`, `.preview-box`, `.progress-ring`
- Hierarchical: parent-child relationship in names (e.g., `.scan-page`, `.scan-page-num`, `.scan-page-remove`)

## Where to Add New Code

**New Feature (form field or validation):**
- Primary code: `app.js` (in relevant section or new section at end)
- Form HTML: within `renderApp()` function (lines 149-299)
- State variable: declare at top with other globals (lines 13-17)
- Handler: `oninput` or `onchange` attribute in HTML, call `updateAll()` at end
- Styling: `style.css` (add to appropriate component section)
- Example: To add a custom date range input, add HTML in `renderApp()`, update `getBaseName()` to include in filename, add CSS class for styling

**New Image Processing Step:**
- Add function in image processing section (lines 390-620)
- Call from `processImage()` pipeline (lines 344-388)
- Example: To add sharpening filter, create `sharpenImage()` function after `applyAdaptiveThreshold()`, call it after blur but before threshold

**New OneDrive Folder Structure:**
- Update CONFIG.ONEDRIVE_BASE if root folder changes (line 6)
- Update `handleSubmit()` folderPath construction (line 845)
- Example: To add service codes, modify folderPath from `${type}/${prefix}-${num}/Maintenance` to `${type}/${serviceCode}/${prefix}-${num}/Maintenance`

**New Authentication Mechanism:**
- Replace PKCE functions (lines 26-33) while keeping same interface
- Modify token storage/retrieval in `saveToken()`/`loadToken()` (lines 80-91)
- Update OAuth endpoint calls (lines 49, 66)
- Example: To switch to implicit flow, create new `startLoginImplicit()`, modify `DOMContentLoaded` to detect hash instead of query param

**New Styling Theme:**
- Add CSS variables to `:root` block (lines 1-32)
- Extend dark mode media query (lines 19-32)
- Reference existing variables throughout (--green, --text, --bg, --border)

**New Toast Message:**
- Call `showToast(msg, type)` from anywhere (line 902)
- Type can be: 'success', 'error', or '' (default)
- Example: `showToast('Document scanned successfully', 'success')`

**Testing (if added):**
- No test framework currently in use
- If adding: consider separate `*.test.js` or `*.spec.js` files
- Mock Canvas API, Fetch API, and Microsoft Graph endpoints

**Progressive Enhancement:**
- Check `navigator.serviceWorker` before registering (line 101-102)
- Check `'serviceWorker' in navigator` (defensive coding pattern used)
- All features degrade gracefully if APIs unavailable

## Special Directories

**`.planning/codebase/`:**
- Purpose: Generated codebase analysis documents
- Generated: Yes (by `/gsd:map-codebase` command)
- Committed: Yes (to git)
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md as needed

**`icons/`:**
- Purpose: PWA app icons for browser/OS display
- Generated: No (static assets)
- Committed: Yes (to git)
- Modification: Update `manifest.json` entries if icon filenames change

**.git/:**
- Purpose: Git version control
- Generated: Yes (git init)
- Committed: N/A (version control system itself)

## Configuration Files

**app.js CONFIG object (lines 1-8):**
- `CLIENT_ID`: Azure app registration ID (must update before deployment)
- `TENANT_ID`: 'common' allows multi-tenant login
- `REDIRECT_URI`: Must match app registration URI exactly (currently points to GitHub Pages)
- `ONEDRIVE_BASE`: Root folder name on OneDrive for all uploads

**manifest.json:**
- `name` / `short_name`: App display name
- `start_url`: Entry point ("/")
- `theme_color`: Browser chrome color (#0F6E56)
- `icons`: Array of icon definitions with purposes

**style.css `:root`:**
- Color variables: --green, --green-dark, --green-light, --text, --bg, --border
- Spacing variables: --radius (12px), --radius-lg (16px)
- Dark mode overrides in media query

## File Size Summary

- `app.js`: 34.6 KB (34,614 bytes, ~910 lines including all algorithms)
- `style.css`: 10.7 KB (10,698 bytes)
- `index.html`: 842 bytes
- `manifest.json`: 479 bytes
- `sw.js`: 1,264 bytes
- Icons: ~6.6 KB combined (icon-192.png + icon-512.png)

## Import Strategy

**External Dependencies:**
- jsPDF: Loaded via CDN in `index.html` (line 19): `https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js`
  - Used in `buildPdfFromPages()` to create multi-page PDFs
  - Accessed as `window.jspdf` global

**No Build Step:**
- No module bundler (webpack, vite, parcel)
- No npm dependencies
- No TypeScript compilation
- Pure vanilla JavaScript (ES6 features used: arrow functions, template literals, destructuring, async/await)

**APIs Used:**
- Web APIs: Canvas, Fetch, Crypto, IndexedDB (service worker caching)
- Microsoft Graph API v1.0 (OneDrive/SharePoint)
- Microsoft OAuth 2.0 endpoints

---

*Structure analysis: 2026-03-16*

# Architecture

**Analysis Date:** 2026-03-16

## Pattern Overview

**Overall:** Single-Page Application (SPA) with Progressive Web App (PWA) capabilities, built as a standalone HTML/CSS/JavaScript client-side application.

**Key Characteristics:**
- Entirely client-side with no backend server
- PWA installable via service worker and manifest
- Direct OAuth 2.0 integration with Microsoft Graph API
- Image processing pipeline with canvas-based document scanning
- Offline-capable with cache-first strategy for static assets

## Layers

**Presentation Layer:**
- Purpose: Render user interface and handle user interactions
- Location: `index.html` (DOM template), `app.js` (DOM rendering functions), `style.css` (styling)
- Contains: UI rendering (`renderAuth()`, `renderApp()`), form input handlers, toast notifications
- Depends on: State management layer
- Used by: User interactions (clicks, input changes)

**State Management Layer:**
- Purpose: Maintain application state in memory
- Location: `app.js` (global variables: `accessToken`, `files`, `scanPages`, `isUploading`)
- Contains: In-memory state variables, form field values via DOM element lookups
- Depends on: Nothing (central hub)
- Used by: All other layers

**Authentication Layer:**
- Purpose: Handle Microsoft OAuth 2.0 PKCE authentication flow
- Location: `app.js` (functions: `generatePKCE()`, `startLogin()`, `exchangeCodeForToken()`, `saveToken()`, `loadToken()`, `signOut()`)
- Contains: PKCE implementation, token exchange, session storage operations
- Depends on: Microsoft login.microsoftonline.com endpoint
- Used by: Boot sequence, sign-out handler

**Image Processing Layer:**
- Purpose: Transform camera input to B&W PDF-ready canvas
- Location: `app.js` (functions: `processImage()`, `loadImage()`, `gaussianBlur()`, `sobelEdges()`, `findDocumentCorners()`, `perspectiveWarp()`, `applyAdaptiveThreshold()`)
- Contains: Canvas-based image manipulation, edge detection, perspective transformation, adaptive thresholding
- Depends on: HTML5 Canvas API, crypto.subtle (for PKCE only)
- Used by: Document scanner

**Document Scanning Layer:**
- Purpose: Capture images and convert to multi-page PDF
- Location: `app.js` (functions: `openCamera()`, `handleCameraCapture()`, `buildPdfFromPages()`, `renderScanPages()`, `removeScanPage()`, `addMorePages()`)
- Contains: Camera input handling, page management, jsPDF integration
- Depends on: Image processing layer, jsPDF library (CDN)
- Used by: File upload workflow

**File Management Layer:**
- Purpose: Track and organize files for upload
- Location: `app.js` (functions: `handleFiles()`, `removeFile()`, `renderFileList()`, `getBaseName()`)
- Contains: File array manipulation, filename generation logic
- Depends on: Naming layer
- Used by: Upload workflow, UI updates

**Naming Layer:**
- Purpose: Generate standardized OneDrive filenames and folder paths
- Location: `app.js` (functions: `getServiceLabel()`, `getBaseName()`)
- Contains: Naming rules (TR/TL prefix, zero-padded unit numbers, date/service type in filename)
- Depends on: Form field values
- Used by: File management, preview rendering, upload

**OneDrive Integration Layer:**
- Purpose: Communicate with Microsoft Graph API for file upload
- Location: `app.js` (functions: `ensureFolder()`, `uploadFile()`, `handleSubmit()`)
- Contains: REST API calls, folder creation, file upload with progress tracking
- Depends on: Authentication layer (access token), Microsoft Graph endpoint
- Used by: Upload submission handler

**Service Worker (Offline Support):**
- Purpose: Cache static assets and enable offline functionality
- Location: `sw.js`
- Contains: Cache versioning (`camiora-v3`), static asset list, network-first for CDN, cache-first for app assets
- Depends on: Caches API, Fetch API
- Used by: Browser (automatic), navigation preservation

## Data Flow

**Authentication Flow:**

1. App loads → `loadToken()` checks sessionStorage for valid token
2. If valid token exists → render main app, skip login
3. If no valid token → render login screen
4. User clicks "Sign in with Microsoft" → `startLogin()` generates PKCE pair
5. PKCE verifier stored in sessionStorage
6. Redirect to Microsoft OAuth authorize endpoint with PKCE challenge
7. User authenticates, Microsoft redirects back with `code` parameter
8. `exchangeCodeForToken(code)` swaps code + verifier for access token
9. Token saved to sessionStorage (`ms_token`, `ms_token_exp`)
10. App renders main form

**Document Capture Flow:**

1. User clicks "Scan document" → `openCamera()` triggers file input
2. User selects/captures image
3. `handleCameraCapture()` loads image via `loadImage()`
4. Image processed through pipeline: `processImage()` → grayscale → blur → edge detection → corner detection → perspective warp → adaptive threshold
5. Processed canvas added to `scanPages[]` array
6. `buildPdfFromPages()` generates multi-page PDF via jsPDF
7. PDF blob converted to File object and pushed to `files[]`
8. Toast shows file size and page count

**File Upload Flow:**

1. User fills form fields (unit type, number, service type, date, optional mileage)
2. Files collected in `files[]` (either from scanned document or manual PDF upload)
3. On form changes → `updateAll()` updates preview box with generated filename pattern and OneDrive path
4. User clicks "Upload to OneDrive"
5. `handleSubmit()` constructs folder path: `Fleet Maintenance/Trucks|Trailers/TR|TL-###/Maintenance`
6. `ensureFolder()` recursively creates folder structure via Graph API (POST requests with 404 handling)
7. For each file → `uploadFile()` sends PUT request to Graph API with file content
8. Progress bar updates after each file
9. On success → form resets, toast shows count
10. On failure → error toast, retry allowed

**State Management Flow:**

1. Form input changes trigger `updateAll()` via `oninput`/`onchange` handlers
2. `updateAll()` reads current form values from DOM
3. Updates preview box with generated filename and path
4. Enables/disables submit button based on form completion
5. Changes trigger re-renders of file list and preview
6. No state saved to localStorage (uses sessionStorage for auth only)

## Key Abstractions

**Token Management:**
- Purpose: Encapsulate OAuth token lifecycle
- Examples: `saveToken()`, `loadToken()`, `signOut()`
- Pattern: Session storage-based, expiration tracked via timestamp

**Image Processing Pipeline:**
- Purpose: Abstract multi-step document image transformation
- Examples: `processImage()` orchestrates grayscale → blur → edge detection → warp → threshold
- Pattern: Functional composition, each step transforms canvas/data and passes to next

**Folder Ensurance:**
- Purpose: Recursively create nested folder structure on OneDrive
- Examples: `ensureFolder()` splits path, makes HEAD requests, creates missing folders
- Pattern: Iterative recursive folder creation with conflict renaming

**Form Naming Logic:**
- Purpose: Generate consistent, meaningful filenames from form data
- Examples: `getBaseName()` combines unit type prefix, padded number, service type, date, mileage
- Pattern: String formatting with conditional parts (mileage optional, index when multiple files)

## Entry Points

**Browser Load:**
- Location: `index.html`
- Triggers: User navigates to app URL
- Responsibilities: Load CSS, register service worker, check for OAuth code in URL, decide auth vs. app screen

**DOMContentLoaded Event:**
- Location: `app.js` (line 100)
- Triggers: HTML parsing complete
- Responsibilities: Register service worker, check for OAuth redirect code, load token or show login

**OAuth Redirect Handler:**
- Location: `app.js` (line 105-115)
- Triggers: Browser receives `?code=...` from Microsoft
- Responsibilities: Extract code, call `exchangeCodeForToken()`, save token, render app

## Error Handling

**Strategy:** Try-catch in async operations with user-facing toast notifications, network error recovery.

**Patterns:**
- Auth failure → console.error + return null, app shows login screen
- Token exchange failure → console.error, message logged, user sees login
- Image processing error → catch in `handleCameraCapture()`, toast shows "Failed to process image"
- Upload failure → catch in `handleSubmit()`, button state reset, toast shows "Upload failed — check connection"
- Network errors → Fetch API rejects, caught, user can retry
- Service worker errors → catch silently, app still works without offline support

## Cross-Cutting Concerns

**Logging:**
- `console.error()` for auth failures, token exchange failures, upload errors
- `console.log()` not used (silent errors acceptable for UX)

**Validation:**
- Form completion checked via `updateAll()` (all required fields filled)
- File list must have at least one file
- Service type required (or custom text if "Other" selected)
- File type restricted to PDF in file picker (`accept=".pdf"`)
- Image file type restricted to camera capture (`accept="image/*"`)

**Authentication:**
- Bearer token passed in Authorization header for all Graph API calls
- Token expiration tracked via sessionStorage timestamp
- Token cleared on sign-out
- PKCE prevents authorization code interception

**Progress Tracking:**
- Upload progress animated via SVG circle stroke-dashoffset (visual feedback)
- File index tracked: `(i + 1) / files.length` to calculate progress percentage
- No incremental progress from server (file-by-file progress only)

---

*Architecture analysis: 2026-03-16*

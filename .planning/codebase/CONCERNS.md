# Codebase Concerns

**Analysis Date:** 2026-03-16

## Tech Debt

**Hardcoded Configuration in Source Code:**
- Issue: Microsoft OAuth CLIENT_ID, TENANT_ID, REDIRECT_URI are hardcoded in `app.js` lines 2-7. While these are not secrets (client-side OAuth doesn't use secrets), this tightly couples configuration to code and makes multi-environment deployments (staging, production) difficult.
- Files: `app.js` lines 2-7
- Impact: Cannot easily deploy to different GitHub organizations or domain names without modifying source code. Requires manual editing before each deployment.
- Fix approach: Move CONFIG to a separate `config.js` file loaded before `app.js`, or inject CONFIG from `index.html` via data attributes on the script tag. This allows environment-specific configuration without code changes.

**Monolithic app.js (909 lines):**
- Issue: All logic — auth, scanning, image processing, OneDrive upload, UI rendering — lives in a single file. No module separation or reusability.
- Files: `app.js`
- Impact: Difficult to test individual functions. Hard to reuse image processing or auth logic in other projects. Cognitive load when debugging. Any change risks breaking unrelated functionality.
- Fix approach: Extract into modules:
  - `auth.js` — PKCE flow, token management
  - `scanner.js` — Image loading, processing (Gaussian blur, Sobel, corner detection, perspective warp, adaptive threshold)
  - `upload.js` — OneDrive folder creation, file upload
  - `ui.js` — Rendering templates and event handlers
  - `naming.js` — File naming logic

**Inadequate Error Handling:**
- Issue: Most failures silently catch errors then show a generic toast. Example: `uploadFile()` at line 833 throws `new Error()` but callers only show "Upload failed — check connection" without indicating what actually failed (network timeout? auth expired? OneDrive quota exceeded? permission denied?).
- Files: `app.js` lines 71, 326, 833, 887-889
- Impact: Users and admins cannot diagnose failures. A token refresh might have failed silently. A missing permission goes unnoticed. Network errors get the same message as permission errors.
- Fix approach: Create error types (AuthError, UploadError, NetworkError) and propagate specific reasons. Log to console with full error context. Show specific guidance in UI: "Session expired — sign in again" vs. "OneDrive quota exceeded — contact IT"

**No Offline Support for Authentication:**
- Issue: Token is stored in `sessionStorage` (line 81-82, 86-91), which is cleared when the session ends or the app is closed. If user signs in, closes the app, then tries to use it offline, they must sign in again online first.
- Files: `app.js` lines 81-91, 86-91
- Impact: PWA claims offline capability (service worker caches app shell), but auth doesn't persist. Severely limits offline usability.
- Fix approach: Store token in `localStorage` instead of `sessionStorage`, with secure expiration logic. Add token refresh before expiry. Consider adding a "Sign in offline with cached credentials" option for previously authenticated users.

**Image Processing Parameters Are Magic Numbers:**
- Issue: Multiple hardcoded values with no explanation:
  - Line 348: `1200` — max dimension for scaling
  - Line 426: `50` — edge detection threshold
  - Line 427: `0.02` — margin as percentage of image
  - Line 434, 448: `20` — number of scan rows/columns
  - Line 462: `3` — minimum points to fit lines
  - Line 508: `0.15` — minimum quad area as percentage
  - Line 594-595: `15` and `30` — block size for adaptive threshold, constant C=8
- Files: `app.js` lines 348, 426-427, 434, 448, 462, 508, 594-595
- Impact: Difficult to tune image processing. If scans fail on certain document types, unclear which parameter to adjust. Impossible to create variations for different use cases (small receipts vs. large maintenance sheets).
- Fix approach: Extract into a config object at the top of the scanner module with descriptive names. Document why each value was chosen. Add comments explaining the impact of changing each value.

**No CORS Handling in Graph API Calls:**
- Issue: Fetch requests to Microsoft Graph API (lines 806, 814, 824) don't explicitly set CORS headers or handle CORS errors. If a browser blocks a request, the error handling is generic (line 833, 889).
- Files: `app.js` lines 806, 814, 824
- Impact: CORS errors manifest as generic "Upload failed" messages instead of being clearly identified and handled. Reduces debuggability.
- Fix approach: Explicitly handle CORS errors by checking response headers. Log CORS-specific guidance if a 0 status code is returned (CORS block).

**Session/Token Expiry Not Monitored:**
- Issue: Token expiry time is calculated at save time (line 82: `Date.now() + (expiresIn || 3600) * 1000`) but never refreshed or proactively renewed. If user is active for >1 hour, their token expires silently and the next API call fails.
- Files: `app.js` lines 80-91
- Impact: Users can fill out a form for 2+ hours, click upload, and get "Upload failed" without knowing their session expired. Bad UX.
- Fix approach: Add a token refresh mechanism before the token expires. When remaining time < 5 minutes, automatically request a new token. Warn user if they've been inactive and session is about to expire.

**No Retry Logic for Transient Failures:**
- Issue: Network requests (GraphAPI, token exchange) fail once and give up. Transient network hiccups cause uploads to fail completely.
- Files: `app.js` lines 65, 806, 814, 824
- Impact: Flaky networks (cellular, public WiFi) result in failed uploads even though retrying would succeed.
- Fix approach: Implement exponential backoff retry (3 attempts with 1s, 2s, 4s delays) for network requests. Treat certain HTTP status codes (5xx, 429) as retriable; treat 4xx as permanent failures.

**No Input Validation on File Upload:**
- Issue: `handleFiles()` at line 708 accepts any File object without validation. `buildPdfFromPages()` at line 668 assumes `scanPages` has valid canvas elements.
- Files: `app.js` lines 708-712, 668-705
- Impact: Malformed files could be uploaded. Empty or corrupted scans could hang the PDF builder. No file size limits checked.
- Fix approach: Validate file size (reject > 100MB), file type (only .pdf), and scanned images (check canvas dimensions are valid before PDF generation).

**Memory Leak in Image Processing:**
- Issue: `processImage()` creates multiple canvas elements (`work`, `output`) but never explicitly releases them. `perspectiveWarp()` at line 513 allocates large typed arrays (srcData, outData) that may not be garbage collected immediately. `scanPages` array holds references to processed canvas elements indefinitely.
- Files: `app.js` lines 344-388, 513-568, 17
- Impact: Processing many scans (>10) in a single session will accumulate canvases and typed arrays in memory. On mobile devices, this can cause browser slowdown or crash.
- Fix approach: Add cleanup methods to explicitly release resources. Call `canvas.width = 0; canvas.height = 0;` to free canvas memory. Clear `scanPages` array when user navigates away or signs out. Consider limiting scan pages to a reasonable number (e.g., 20 max).

**No Accessibility Attributes:**
- Issue: Buttons and interactive elements lack ARIA labels, roles, or descriptions. Form fields use HTML labels but no `aria-required`, `aria-invalid`, or `aria-describedby` attributes.
- Files: `app.js` lines 136-145, 163-164, 230-267, 282-288, 855-898 (inline HTML strings with no a11y markup)
- Impact: Screen reader users cannot operate the app. Keyboard navigation is poor (no focus management). Violates WCAG accessibility standards.
- Fix approach: Add ARIA attributes to all interactive elements. Implement keyboard navigation (Tab, Enter, Escape). Test with screen readers (NVDA on Windows, VoiceOver on iOS).

## Known Bugs

**PDF Generation Fails on Very Large Scans:**
- Symptoms: When processing an image >4000px dimension, `perspectiveWarp()` creates an enormous canvas. The PDF generation hangs or crashes the browser.
- Files: `app.js` lines 513-568, 668-705
- Trigger: Take a high-resolution photo (e.g., 5000x3000) on a modern phone, try to scan
- Workaround: The `processImage()` function does scale images down to 1200px max (line 348), but if perspective warp increases dimensions, it can exceed that again
- Fix approach: Cap output dimensions in `perspectiveWarp()` to 1200x1600 (max A4 equivalent). Resample output if it exceeds limit.

**Service Worker Cache Not Cleared on Update:**
- Symptoms: After deploying a new version of the app, users see outdated code/styles cached in their browser until they manually clear cache or wait for cache expiration.
- Files: `sw.js` lines 1-49
- Trigger: Developer deploys changes, user has old version cached, user doesn't see updates for hours
- Cause: Service worker uses `const CACHE = 'camiora-v3'` (line 1). When code is updated, the cache name doesn't change, so old files are served indefinitely.
- Workaround: Users can manually clear browser cache or use "App Storage" in Settings
- Fix approach: Update `CACHE` version constant to include a build timestamp or hash (e.g., `'camiora-' + new Date().getTime()`). Or better: use a build process to generate the cache version at deploy time.

**Camera Input Not Cleared After Cancellation:**
- Symptoms: If user opens camera, takes a photo, then removes the page without confirming, the file input (`#cameraInput`) still contains the file. Clicking "Scan document" again shows the old file.
- Files: `app.js` lines 302-305
- Trigger: User taps "Scan", takes photo, taps remove (×), taps "Scan" again
- Cause: `openCamera()` sets `input.value = ''` (line 303) but only on the click event. The file input remembers the previous file if the element isn't recreated.
- Workaround: Manually reload the app
- Fix approach: After `removeScanPage()`, reset the camera input: `document.getElementById('cameraInput').value = '';`

**Perspective Warp Produces Black Corners:**
- Symptoms: After scanning a document at an angle, the warped output has black/white corners where the perspective transform couldn't find source pixels.
- Files: `app.js` lines 534-564
- Trigger: Scan a document at a shallow angle (close to camera level)
- Cause: Bilinear interpolation at line 549 skips pixels outside source bounds with `continue`, leaving those pixels at their default (0, 0, 0, 255) — black
- Fix approach: Replace `continue` with a fallback: use the nearest valid pixel or extend edge pixels to fill gaps.

**OneDrive Folder Creation Race Condition:**
- Symptoms: On very slow connections, if multiple files are uploaded rapidly, the folder creation request for files[1] might not complete before files[0] upload starts, causing uploads to fail with 404.
- Files: `app.js` lines 856-867
- Trigger: Very slow network (2G), upload multiple files, folder doesn't exist yet
- Cause: `ensureFolder()` (line 801) is awaited once before the loop, but folder creation might not complete before first upload
- Fix approach: Ensure folder structure before entering the upload loop and wait for all folder creations to complete. Alternatively, add retry logic for 404 errors during upload.

## Security Considerations

**Client ID Visible in GitHub:**
- Risk: The CLIENT_ID is hardcoded in `app.js` line 3 and committed to GitHub. While not a secret (used only on client-side), it could be used to abuse the OAuth endpoint or impersonate the app.
- Files: `app.js` line 3
- Current mitigation: OAuth redirect URI is pinned to a specific GitHub Pages URL, so the client ID can only be used from that exact domain. Azure AD also restricts scopes to `Files.ReadWrite User.Read`, limiting what an attacker could do even if they misuse the client ID.
- Recommendations:
  - Consider creating separate client IDs for dev/staging/production to limit blast radius if one is compromised
  - Monitor Azure AD sign-in logs for suspicious activity
  - Document that CLIENT_ID should not be shared; it's organization-specific and tied to your Azure tenant

**No Verification of OneDrive Folder Path:**
- Risk: User-supplied unit type and number are directly interpolated into OneDrive folder paths (line 845: `${CONFIG.ONEDRIVE_BASE}/${type}/${prefix}-${num}/Maintenance`). If an attacker controls unit type/number, they could craft paths like `../../../sensitive-folder/` to traverse directories.
- Files: `app.js` lines 754-766, 845
- Current mitigation: Input is constrained to select dropdowns (`<select>`), so user cannot enter arbitrary values. Path traversal via `../` is unlikely.
- Recommendations:
  - Validate unit number format on upload: only alphanumeric, no special characters, length < 20
  - Whitelist allowed service types instead of relying on HTML select validation
  - Log all upload paths to detect suspicious patterns

**No HTTPS Enforcement:**
- Risk: If the app is served over HTTP instead of HTTPS, tokens and file data could be intercepted in transit.
- Files: All network calls assume HTTPS
- Current mitigation: GitHub Pages enforces HTTPS. The OAuth redirect URI pinned in Azure AD requires HTTPS.
- Recommendations: Add explicit check in `index.html` or `app.js` to warn if running on HTTP: `if (location.protocol !== 'https:') { alert('This app requires HTTPS'); }`

**Token Stored in SessionStorage (Not Secure):**
- Risk: SessionStorage persists across page reloads but is cleared on browser close. Tokens could be accessed by other tabs or scripts if any XSS vulnerability exists.
- Files: `app.js` lines 81-91
- Current mitigation: No user-generated content is rendered as HTML (all values are set via `.textContent` or `.value`), so XSS is unlikely. Service worker doesn't expose storage.
- Recommendations:
  - Consider storing token in memory only (lose it on page reload) to minimize exposure
  - If persisting to storage, use encrypted localStorage
  - Add Content Security Policy (CSP) header to prevent inline script injection

**File Upload to OneDrive Has No Virus Scanning:**
- Risk: Users upload scans to OneDrive without any antivirus or malware checking. If a user's device is compromised and uploads a malicious PDF, it spreads to OneDrive.
- Files: `app.js` lines 823-835
- Current mitigation: Microsoft Defender for OneDrive performs automatic scanning on files in Microsoft 365 (if enabled in admin settings).
- Recommendations:
  - Document that administrators should enable OneDrive malware scanning
  - Log uploads in Azure AD audit log for compliance
  - Consider server-side validation if uploading to a proxy instead of directly to OneDrive

## Performance Bottlenecks

**Image Processing Runs on Main Thread:**
- Problem: `processImage()`, `gaussianBlur()`, `sobelEdges()`, and `perspectiveWarp()` all run synchronously on the main thread. Processing a 2000x1500px image takes 2-5 seconds, during which the UI freezes.
- Files: `app.js` lines 344-620
- Cause: No Web Worker usage. Gaussian blur (line 390-405) is O(n*25) where n = pixels. Sobel edge detection (line 407-422) is O(n*9).
- Improvement path:
  1. Move `processImage()` and all sub-functions to a Web Worker (`scanner-worker.js`)
  2. In `handleCameraCapture()`, call worker via `worker.postMessage({ img: imageData })` instead of direct function call
  3. Worker returns processed canvas data; main thread renders
  4. This keeps UI responsive even for large scans

**No Image Downsampling Before Processing:**
- Problem: Images are scaled to 1200px max (line 348) but then all processing runs at that resolution. A 1200x1600 image = 1.92M pixels; Gaussian blur processes 1.92M * 25 = 48M operations. Could take 3+ seconds.
- Files: `app.js` line 348
- Improvement path:
  1. Downsampling: Process at 600x800 instead, then upscale final output
  2. Skip Gaussian blur if image is already small
  3. Reduce Sobel kernel from 3x3 to 2x2 for faster edge detection
  4. Benchmark and profile to confirm speedup

**PDF Generation Not Streaming:**
- Problem: `buildPdfFromPages()` builds entire PDF in memory, then converts to blob. For large scans or multi-page PDFs, this can consume 50+ MB of RAM.
- Files: `app.js` lines 668-705
- Improvement path:
  1. Use jsPDF streaming mode if supported
  2. Or: Process pages one at a time, serialize to file incrementally
  3. Limit max pages to 50 to prevent memory exhaustion

**No Compression of Thumbnails:**
- Problem: `renderScanPages()` creates thumbnails using `canvas.toDataURL('image/jpeg', 0.3)` (line 639) but doesn't resize the canvas first. A 1200x1600 canvas downsampled to 80x104 CSS size still uses full image memory.
- Files: `app.js` lines 623-646
- Improvement path:
  1. Create actual smaller canvas (80px width) before `toDataURL()`
  2. Reduces memory for thumbnails by ~90x

**Service Worker Caches Everything:**
- Problem: `sw.js` line 47 caches all network responses indefinitely (`caches.match()` always returns cached version). If jsPDF CDN is updated, the app continues using old cached version until cache is manually cleared.
- Files: `sw.js` lines 45-49
- Improvement path:
  1. Use "cache, fallback to network" with a TTL
  2. Or: Whitelist only specific URLs to cache (static assets only, not CDN)
  3. Add a cache bust mechanism (append `?v=123` to script tags in `index.html`)

## Fragile Areas

**Edge Detection and Corner Finding Algorithm:**
- Files: `app.js` lines 407-511
- Why fragile:
  - `findDocumentCorners()` uses a simple threshold-and-scan approach; it fails if:
    - Document has weak edges (low contrast, glare)
    - Background has strong edges (pattern, texture)
    - Document edges aren't straight lines (torn paper, folded corners)
  - Line 426: threshold of `50` is hardcoded; too high misses edges, too low finds false edges
  - Line 462: requires minimum 3 edge points per side; fails if one side is occluded
  - Line 508: quad area check rejects documents < 15% of image; fails on small, distant documents
- Safe modification:
  1. Test with representative scans before changing thresholds
  2. Add debug mode that visualizes edge detection so you can see what's being detected
  3. Make thresholds configurable, not hardcoded
  4. Consider replacing with a more robust method (e.g., Hough transform for line detection)
- Test coverage: No unit tests exist for image processing. Manual testing only.

**OneDrive Folder Enumeration:**
- Files: `app.js` lines 801-821
- Why fragile:
  - Creates folders one-by-one via sequential fetch requests
  - If network fails mid-way, partial folder structure is left in OneDrive
  - No idempotency: if `ensureFolder('A/B')` is called twice with different network conditions, it might create A twice
  - No check for existing folders before creating
- Safe modification:
  1. Add a preflight check: fetch folder before attempting to create
  2. Use a transactional approach: prepare all folder creates, then execute
  3. Add detailed error logging so you know exactly which folder creation failed
- Test coverage: No tests for folder creation logic

**Perspective Warp Line Intersection:**
- Files: `app.js` lines 480-487
- Why fragile:
  - `intersect()` function computes line intersection using determinant division
  - If lines are nearly parallel (determinant ~0), result is unreliable (line 484: `if (Math.abs(d) < 0.001)`)
  - No validation that the four corners form a valid quadrilateral
  - No handling for edge cases: nearly vertical or horizontal lines
- Safe modification:
  1. Add debug output to visualize the detected corners
  2. Validate that corners are sorted in correct order (TL, TR, BR, BL)
  3. Add fallback: if lines don't intersect cleanly, use centroid-based corners
- Test coverage: No unit tests for line intersection logic

**Service Worker Activation Race:**
- Files: `sw.js` lines 19-26
- Why fragile:
  - Activation claims clients immediately (line 25: `self.clients.claim()`), which can cause in-flight requests to use new (different) cached assets
  - If user has app open in multiple tabs, one tab's update can cause the other tab's code to become stale
  - No versioning of critical functionality
- Safe modification:
  1. Only claim clients that are from the same origin and URL
  2. Add a version negotiation: new SW notifies all clients of update, client decides whether to reload
  3. Never claim clients if critical API changes have been made
- Test coverage: No tests for SW behavior across multiple tabs

## Scaling Limits

**Scan Pages Array Unbounded:**
- Current capacity: Can hold ~50-100 scan pages before browser memory pressure becomes severe (each canvas ~500KB, 50 pages = 25MB)
- Limit: Browsers typically limit tab memory to 512MB-2GB depending on device. Mobile devices (<2GB RAM) will crash at ~20 pages.
- Scaling path:
  1. Implement a "finalize and upload" pattern: once user taps "Upload", clear completed scans from memory
  2. Limit UI to 20 pages max, with a warning "Maximum pages reached"
  3. Implement page-streaming: upload pages as they're scanned instead of batching
  4. Consider IndexedDB for temporary storage of processed pages

**OneDrive API Rate Limits:**
- Current capacity: Microsoft Graph API allows ~5000 requests/hour per user. At 1 request per folder creation + 1 per file, 100 files = ~200 requests. Safe limit is ~500 files in one session.
- Limit: If user tries to upload 1000+ files at once, will hit rate limits and get 429 errors
- Scaling path:
  1. Batch folder creations (create all needed folders first, then upload all files)
  2. Add rate limit detection: catch 429 responses and implement exponential backoff
  3. Limit UI to 50 files max per upload session
  4. Consider chunking into multiple uploads (upload 50 files, pause, upload next 50)

**File Size Accumulation:**
- Current capacity: No maximum total file size checked. If user uploads 100 files × 5MB each = 500MB, will succeed but use a lot of bandwidth and storage.
- Limit: ISPs with data caps; OneDrive storage quotas (typically 1TB for M365 users)
- Scaling path:
  1. Add pre-upload validation: total size < 1GB (configurable)
  2. Show total size in UI before upload
  3. Warn users if individual files exceed 10MB
  4. Implement compression: reduce PDF quality or JPEG quality for large files

## Dependencies at Risk

**jsPDF from CDN (Unpinned Version):**
- Risk: `index.html` line 19 loads jsPDF from `cdn.jsdelivr.net/npm/jspdf@2.5.2`. CDN can go down, be compromised, or the hosted file could be replaced. Using `@2.5.2` is good (pinned version), but CDN is not resilient.
- Files: `index.html` line 19
- Impact: If jsPDF CDN is unavailable, PDF generation is disabled entirely
- Migration plan:
  1. Download jsPDF and host locally: `<script src="jspdf.min.js"></script>`
  2. Or: Use a different CDN as fallback (e.g., unpkg.com as secondary)
  3. Bundle jsPDF into the app via a build process (esbuild, Vite)

**Service Worker Caches jsPDF Indefinitely:**
- Risk: If jsPDF has a critical bug or security issue, cached version can't be updated without manual cache clear
- Files: `sw.js` lines 32-44
- Impact: Users continue using buggy version until cache expires
- Migration plan:
  1. Change cache strategy: fetch jsPDF from network first, cache as fallback
  2. Or: Add cache version tied to jsPDF version number
  3. Or: Never cache CDN assets, only cache app shell

**No Fallback for Image Processing Failures:**
- Risk: If image processing throws an error (bad pixel data, insufficient memory), upload fails and user has no alternative
- Files: `app.js` lines 317-332
- Impact: User cannot upload a scan that the algorithm fails on, even though the raw image is valid
- Migration plan:
  1. Add a "Skip processing" option: upload raw image instead of processed PDF
  2. Or: If perspective warp fails, fall back to original image without warp
  3. Or: If adaptive threshold fails, use simple binary threshold as fallback

## Missing Critical Features

**No Retry on Upload Failure:**
- Problem: If an upload fails (network timeout, server error), user must fill out the form again and reselect files. Files are cleared on submit (line 877).
- Blocks: Cannot gracefully handle flaky networks or temporary outages
- Fix approach:
  1. On upload error, keep files and metadata in memory (don't clear)
  2. Add "Retry upload" button that reuses the same data
  3. Or: Implement automatic retry with exponential backoff before giving up

**No Offline Queue:**
- Problem: App cannot queue uploads for later if user is offline. All uploads require live network connection at the moment of clicking "Upload".
- Blocks: Cannot support true offline-first workflow
- Fix approach:
  1. Use IndexedDB to queue uploads with metadata
  2. Check network status on app load; if offline, show "X pending uploads" and "Upload now"
  3. Implement background sync API to trigger uploads when connectivity returns
  4. This enables the true PWA experience users expect

**No Dark Mode Preference Detection:**
- Problem: `style.css` lines 19-32 use `@media (prefers-color-scheme: dark)` correctly, but there's no toggle for manual override. User must use OS settings.
- Blocks: Cannot support user preference for light/dark mode independent of OS
- Fix approach:
  1. Add dark mode toggle button in header
  2. Store preference in localStorage
  3. Apply based on localStorage value, fallback to OS preference

**No Batch Rename Before Upload:**
- Problem: User cannot review or edit file names before upload. If the naming formula is wrong, all files are uploaded with incorrect names and must be manually renamed in OneDrive.
- Blocks: Cannot fix naming mistakes before upload
- Fix approach:
  1. Show preview of final file names for each file before upload
  2. Allow editing individual file names or template
  3. Show OneDrive path where files will be uploaded

**No OneDrive Integration Status Check:**
- Problem: If OneDrive is unavailable (maintenance, quota exceeded, permissions revoked), user won't know until upload fails mid-way.
- Blocks: Cannot validate setup before asking user to fill form
- Fix approach:
  1. On app load, test Graph API with a simple `GET /me` request
  2. If it fails, show setup wizard: "Reconnect to OneDrive"
  3. Show user's name and OneDrive storage quota in header (requires `Files.ReadWrite User.Read` permissions, which are already granted)

## Test Coverage Gaps

**No Tests for Image Processing:**
- What's not tested: `processImage()`, `gaussianBlur()`, `sobelEdges()`, `findDocumentCorners()`, `perspectiveWarp()`, `applyAdaptiveThreshold()` — these are ~250 lines with no test coverage
- Files: `app.js` lines 344-620
- Risk: Edge cases (extreme aspect ratios, very small images, high-contrast documents) may fail silently. Thresholds may be tuned incorrectly for different document types.
- Priority: High — image processing is core to app functionality and very hard to debug when it fails

**No Tests for OAuth Flow:**
- What's not tested: `generatePKCE()`, `startLogin()`, `exchangeCodeForToken()`, `saveToken()`, `loadToken()` — token lifecycle and error cases
- Files: `app.js` lines 26-97
- Risk: Token expiry bugs, PKCE verifier mismatch, redirect loop if Azure AD config changes
- Priority: High — auth is critical; failure blocks entire app

**No Tests for OneDrive Upload:**
- What's not tested: `ensureFolder()`, `uploadFile()`, `handleSubmit()` — folder creation, file upload, error handling, retry logic
- Files: `app.js` lines 801-899
- Risk: Folder structure bugs (partial creates), upload retries, rate limiting, quota errors
- Priority: High — the main user-facing feature

**No Tests for UI State Management:**
- What's not tested: `updateAll()`, `renderFileList()`, `renderScanPages()` — form state, file list consistency, preview box visibility
- Files: `app.js` lines 623-798
- Risk: UI bugs like "Submit button not disabling", "Preview not showing", "File list not updating"
- Priority: Medium — impacts user experience but bugs are usually caught during manual testing

**No Integration Tests:**
- What's not tested: Complete workflows (sign in → scan → upload, sign in → select PDF → upload)
- Risk: Regressions when refactoring code; interaction bugs between modules
- Priority: Medium — manual testing catches these, but automation would speed up development

---

*Concerns audit: 2026-03-16*

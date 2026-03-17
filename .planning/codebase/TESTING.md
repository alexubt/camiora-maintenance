# Testing Patterns

**Analysis Date:** 2026-03-16

## Test Framework

**Status:** No testing framework detected

**Evidence:**
- No `jest.config.js`, `vitest.config.js`, or similar test config files
- No `*.test.js` or `*.spec.js` files in codebase
- No test dependency entries (project has no package.json)
- No test scripts or test runner commands

**Project Structure:**
This is a vanilla browser-based PWA with no build tool, no package manager, and no automated testing infrastructure.

## Manual Testing Approach

The codebase relies on manual testing and visual verification in the browser.

**Testing Areas:**
1. **Authentication (lines 20-97)**
   - PKCE flow initialization: `generateRandomString()`, `generatePKCE()`
   - Token exchange: `exchangeCodeForToken()`
   - Token persistence: `saveToken()`, `loadToken()`
   - Session cleanup: `signOut()`

2. **Image Processing (lines 343-620)**
   - Image loading: `loadImage()` - Promise-based Image loading
   - Grayscale conversion (line 359-365)
   - Gaussian blur (line 390-405)
   - Sobel edge detection (line 407-422)
   - Document corner detection (line 424-511)
   - Perspective warp (line 513-568)
   - Adaptive threshold (line 570-620)

3. **File Handling (lines 707-742)**
   - Multiple file additions: `handleFiles()`
   - File removal: `removeFile()`
   - File list rendering: `renderFileList()`
   - PDF creation from scans: `buildPdfFromPages()`

4. **Form Validation (lines 768-798)**
   - Service type selection with "other" field: `updateAll()`
   - Required field validation: unit type, unit number, service type, date
   - Preview generation: `getBaseName()`, file naming logic

5. **OneDrive Upload (lines 801-899)**
   - Folder structure creation: `ensureFolder()`
   - File upload: `uploadFile()`
   - Progress tracking: `handleSubmit()`
   - Error recovery and retry UI

## Key Testable Functions

**Pure Functions (easiest to test):**
- `generateRandomString(len)` - Line 20: Returns cryptographically random hex string
- `getServiceLabel()` - Line 745: Maps service type to label, handles "other" field
- `getBaseName(i)` - Line 754: Generates file naming pattern from form fields

**Async Functions (require Promise handling):**
- `generatePKCE()` - Line 26: Generates PKCE challenge pair
- `exchangeCodeForToken(code)` - Line 52: OAuth token exchange
- `loadImage(file)` - Line 334: Wraps Image load in Promise
- `buildPdfFromPages()` - Line 668: Generates PDF from canvas elements
- `uploadFile(file, remotePath)` - Line 823: PUT request to OneDrive

**Complex Functions (multi-step):**
- `processImage(img)` - Line 344: Full image processing pipeline
  - Scaling
  - Grayscale conversion
  - Gaussian blur
  - Edge detection
  - Corner detection
  - Perspective warp
  - Adaptive threshold

## Data Flow Testing

**Authentication Flow (lines 100-117):**
1. Page load: `DOMContentLoaded` event
2. Check for OAuth code in URL search params
3. Exchange code for token via `exchangeCodeForToken()`
4. Save token via `saveToken()`
5. Render app or auth screen

**File Upload Flow (lines 837-899):**
1. User submits form: `handleSubmit()`
2. Create folder path from unit type/number
3. Ensure folder structure exists: `ensureFolder()`
4. Upload each file: `uploadFile()` for each file
5. Track progress via stroke-dashoffset animation
6. Show success toast and reset form

**Document Scanning Flow (lines 307-332):**
1. User opens camera: `openCamera()`
2. Image loads via file input: `handleCameraCapture()`
3. Process image: `processImage()` with edge detection + perspective warp
4. Append to `scanPages` array
5. Build PDF: `buildPdfFromPages()`
6. Add to files list

## Edge Cases & Error Scenarios

**Authentication:**
- Missing PKCE verifier in session storage (line 54): Returns null
- Failed token exchange (line 70-72): Logs error, returns null
- Expired token (line 89): Checks expiration time, returns false

**Image Processing:**
- No document corners detected (line 462): Returns null, uses full image
- Invalid corner intersections (line 494): Returns null
- Quad area too small (line 508): Returns null, fallback to unwarped image

**File Operations:**
- No selected file (line 308): Function returns early
- Upload fails (line 833): Throws error with status code
- Missing access token (line 807): Headers will have invalid Authorization

**Form Validation:**
- Missing required fields (line 760): `getBaseName()` returns null
- Submit button validation (line 795): Checks all conditions, disabled if incomplete

## Browser APIs Used

**No mocking needed for:**
- Web Crypto API: `crypto.getRandomValues()`, `crypto.subtle.digest()`
- Canvas API: `document.createElement('canvas')`, ImageData operations
- Fetch API: Direct HTTP requests to Microsoft Graph
- Service Worker API: `navigator.serviceWorker.register()`
- Session Storage: `sessionStorage.getItem()`, `sessionStorage.setItem()`
- File API: `File` constructor, `Blob.size`

## Recommended Testing Strategy

**If testing framework were added (hypothetical):**

1. **Unit Tests** - Pure functions
   ```javascript
   // Test getServiceLabel() with various inputs
   // Test getBaseName() with missing fields
   // Test generateRandomString() length
   ```

2. **Integration Tests** - Multi-step flows
   ```javascript
   // Mock Microsoft Graph responses
   // Test complete upload flow
   // Test authentication redirect
   ```

3. **Image Processing Tests** - Heavy computation
   ```javascript
   // Mock canvas and image data
   // Verify edge detection produces edges
   // Verify perspective warp dimensions
   ```

4. **Form Validation Tests**
   ```javascript
   // Test naming rules for different unit types
   // Test conditional field visibility (otherWrap)
   // Test button disabled state transitions
   ```

## Current Manual Test Coverage

**Visual/Manual Testing Areas:**
- Auth flow: Sign in, token persistence, sign out
- Form completion and validation
- Document scanning: Camera capture, PDF generation
- File upload: Multi-file handling, progress UI
- Error states: Connection failures, invalid inputs
- Mobile responsiveness and touch interactions

---

*Testing analysis: 2026-03-16*

**Note:** This project lacks automated testing infrastructure. To add testing:
1. Add test runner (Jest or Vitest)
2. Mock Canvas and Image APIs
3. Mock Fetch for OneDrive calls
4. Mock navigator.serviceWorker
5. Add test files alongside source files

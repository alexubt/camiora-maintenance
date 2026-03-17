# Coding Conventions

**Analysis Date:** 2026-03-16

## Naming Patterns

**Files:**
- Lowercase with dashes for separators: `app.js`, `sw.js`
- No file type extensions used beyond standard (no `.service.js`, `.component.js` etc.)

**Functions:**
- camelCase for all function declarations and arrow functions
- Examples: `generateRandomString()`, `exchangeCodeForToken()`, `handleCameraCapture()`, `renderAuth()`
- No naming prefixes or suffixes (no `_private()`, `get*()` getters)

**Variables:**
- camelCase for local and module-scoped variables
- ALL_CAPS for constants at module scope
- Examples:
  - Constants: `CONFIG`, `SCOPES`, `GRAPH`, `CACHE`, `STATIC`
  - Variables: `accessToken`, `isUploading`, `scanPages`, `files`
- Single-letter variables used in tight loops: `i`, `x`, `y`, `w`, `h`, `r`, `g`, `b`

**HTML Elements/DOM:**
- kebab-case for HTML IDs: `cameraInput`, `unitType`, `serviceType`, `scanZone`, `fileList`
- Descriptive ID names tied to function purpose: `progressArc`, `submitBtn`, `previewBox`

**Types:**
- No TypeScript (vanilla JavaScript project)
- Object properties use camelCase: `CONFIG.CLIENT_ID`, `CONFIG.REDIRECT_URI`, `token.access_token`

## Code Style

**Formatting:**
- No configured formatter (no .prettierrc or eslint config found)
- **Observed conventions:**
  - 2-space indentation throughout
  - No semicolons at end of statements (optional chaining used minimally)
  - Arrow functions preferred: `() => {}` over function expressions
  - Template literals used for string interpolation: `` `string ${var}` ``

**Linting:**
- No configured linter (no .eslintrc, biome.json, or eslint.config.* found)
- Code appears hand-formatted with consistent style

**Line Length:**
- Approximately 100-120 characters per line observed
- Longer conditional/logic chains broken into multiple lines
- Function calls broken across lines when parameters exceed reasonable width

## Import Organization

**Script Loading:**
- Single external library loaded via CDN: jsPDF library in `index.html`
- No module system used (vanilla browser globals)
- Service Worker registered at runtime in DOMContentLoaded: `navigator.serviceWorker.register('sw.js')`

**Path Organization:**
- No path aliases used
- All resources relative to root: `./style.css`, `./app.js`, `./manifest.json`, `./sw.js`, `./icons/`

## Error Handling

**Patterns:**
- Try-catch blocks used for async operations: `try { ... } catch (err) { ... }`
- Fetch responses checked with `.ok` property: `if (!resp.ok) { ... }`
- Console.error() for logging errors: `console.error('error message', details)`
- User-facing errors via toast notifications: `showToast('message', 'error')`
- Null checks on optional DOM elements: `if (!el) return;` or `el?.value`

**Example from `exchangeCodeForToken()`:**
```javascript
if (!resp.ok) {
  console.error('Token exchange failed', await resp.text());
  return null;
}
```

## Logging

**Framework:** Browser console only (no logging library)

**Patterns:**
- `console.error()` for critical failures: token exchange, upload errors, image processing errors
- No info/debug/warn logging observed
- Error logs include context: `console.error('Scan error:', err)`
- User feedback via toast instead of console logs

## Comments

**When to Comment:**
- Section dividers: `// ── Auth (PKCE authorization code flow) ──────────────────`
- Step-by-step algorithm explanation: Image processing pipeline (lines 358-365)
- Complex mathematical operations: Sobel edge detection, perspective warp

**JSDoc/TSDoc:**
- Not used in this codebase (vanilla JS, no types)

**Comment Style:**
- Single-line comments with dashes for visual separation between major sections
- Inline comments explain "why" not "what": `// B&W images compress well at low quality`

## Function Design

**Size:**
- Small focused functions: 5-20 lines typical
- Complex algorithms split into separate functions: `gaussianBlur()`, `sobelEdges()`, `perspectiveWarp()`
- UI functions (render*) range 10-50 lines

**Parameters:**
- No destructuring in function signatures (avoided)
- DOM elements and file objects passed directly: `handleFiles(newFiles)`, `processImage(img)`
- Configuration via module-scope constants, not parameters: `CONFIG`, `SCOPES`, `GRAPH`

**Return Values:**
- Functions return null on failure: `exchangeCodeForToken()` returns `null` if code invalid
- Async functions return promises/values: `loadToken()` returns boolean
- Render functions return nothing (side-effect only): `renderAuth()`, `renderApp()`
- Promise-returning functions with `.then()` chains and `.catch()` error handling

**Example clean function (getUserLabel):**
```javascript
function getServiceLabel() {
  const v = document.getElementById('serviceType')?.value || '';
  if (v === 'other') {
    return (document.getElementById('otherText')?.value || '')
      .trim().replace(/\s+/g, '-').toLowerCase() || 'other';
  }
  return v;
}
```

## Module Design

**Exports:**
- No module system (vanilla browser script)
- All functions defined at global scope via `window` object
- Inline event handlers call global functions: `onclick="startLogin()"`

**Global State:**
- Module-scope variables act as application state:
  - `let accessToken = null;`
  - `let files = [];`
  - `let isUploading = false;`
  - `let scanPages = [];`

**Function Organization:**
- Functions grouped by feature:
  - Lines 20-97: Authentication (PKCE)
  - Lines 100-118: Boot/initialization
  - Lines 121-146: Auth screen rendering
  - Lines 149-299: Main app rendering
  - Lines 301-332: Camera/scanner
  - Lines 334-620: Image processing
  - Lines 622-705: Scan pages UI
  - Lines 708-798: File handling and naming
  - Lines 801-899: OneDrive upload
  - Lines 901-909: Toast notifications

## Async/Await Patterns

**Style:**
- Modern async/await preferred over .then() chains
- Example: `async function handleSubmit() { ... }`
- Mixed approaches: Some fetch calls use `.then()`, others use await

**Promise Handling:**
- Promises created with `new Promise((resolve, reject) => { ... })`
- Example: `loadImage()` wraps Image load in Promise
- Error handling with try-catch around await

## CSS Conventions

**Custom Properties:**
- CSS variables for theming: `--green`, `--text`, `--bg`, `--border`, `--radius`
- Dark mode support via media query: `@media (prefers-color-scheme: dark)`
- Prefix organization: `--green`, `--green-dark`, `--green-light`, `--green-mid`, `--green-border`

**Class Naming:**
- kebab-case: `.auth-screen`, `.logo-mark`, `.form-body`, `.field`, `.row`
- BEM-like but simplified: `.file-item`, `.file-info`, `.file-orig`, `.file-new`
- State classes: `.show` for visibility toggling

---

*Convention analysis: 2026-03-16*

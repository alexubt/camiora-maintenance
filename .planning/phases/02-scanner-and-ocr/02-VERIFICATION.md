---
phase: 02-scanner-and-ocr
verified: 2026-03-16T00:00:00Z
status: human_needed
score: 5/5 automated must-haves verified
human_verification:
  - test: "B&W quality — photograph a printed invoice"
    expected: "Output looks like a high-contrast black-and-white scanned document: text is crisp, background is white, no gray areas"
    why_human: "Adaptive threshold output quality is a visual judgment; cannot assess pixel appearance without running on a real photo"
  - test: "Deskew — hold phone at 5-10 degree angle when photographing a document"
    expected: "Output PDF shows text lines running horizontally; document is straightened"
    why_human: "Deskew result depends on real-world corner detection from actual image content; cannot assess rotation quality programmatically"
  - test: "Memory stability — scan 5+ invoices in sequence on an older iPhone"
    expected: "App does not crash or become unresponsive after 5 sequential scans"
    why_human: "iOS canvas OOM behavior requires a real device test; cannot simulate GPU memory pressure programmatically"
  - test: "OCR accuracy — scan an invoice that has a visible unit number, date, and service type"
    expected: "Unit #, Date, and Service Type fields are pre-populated with correct values within a few seconds of scanning"
    why_human: "Tesseract.js OCR accuracy on real invoices cannot be assessed without actual invoice images and a running browser"
  - test: "OCR non-overwrite — type a value into Unit # first, then scan another invoice"
    expected: "Unit # field is NOT overwritten by OCR; only empty fields are filled"
    why_human: "Interactive form behaviour requires a browser session to confirm"
---

# Phase 2: Scanner and OCR Verification Report

**Phase Goal:** The scanner produces document-quality output and automatically reads invoice fields
**Verified:** 2026-03-16
**Status:** human_needed — all automated checks passed; 5 items require human browser/device testing
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A photo is converted to high-contrast B&W that looks like a scanned document | ? NEEDS HUMAN | `applyAdaptiveThreshold` and `applyAdaptiveThresholdToArray` exist, are substantive, and are called at the end of `processImage()`. Output quality is a visual judgment. |
| 2 | A crooked photo is automatically straightened before PDF generation | ? NEEDS HUMAN | `computeSkewAngle` + `applyRotation` are implemented and wired inside `processImage()` after corner detection. Straightening quality requires a real photo test. |
| 3 | Capturing and processing multiple invoices in sequence does not crash on an older iPhone | ? NEEDS HUMAN | `processAndRelease` releases canvas memory (`canvas.width = 0; canvas.height = 0`), `state.scanPages` stores Blobs (confirmed in state.js), and `buildPdfFromPages` uses `createImageBitmap` with `bmp.close()`. Actual memory stability requires device test. |
| 4 | OCR extracts text and pre-populates unit, date, and type fields | ? NEEDS HUMAN | `runOCR` and `parseInvoiceFields` exist, are exported, and are wired in `handleCameraCapture` with `runOCR(blob).then(fields => prefillFormFields(fields))`. Field accuracy requires a live browser test. |
| 5 | User can review and correct any OCR-detected field before submitting | ? NEEDS HUMAN | `prefillFormFields` only sets fields that are currently empty (`!document.getElementById('unitNum').value`). Guard logic is present for all three fields. Correct interactive behaviour requires a browser session. |

**Score:** 0/5 truths can be fully verified programmatically — all pass automated code checks but each has a visual/interactive/device component requiring human confirmation.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/imaging/scanner.js` | Extracted imaging pipeline with deskew | VERIFIED | 355 lines; exports: `gaussianBlur`, `sobelEdges`, `findDocumentCorners`, `perspectiveWarp`, `applyAdaptiveThreshold`, `applyAdaptiveThresholdToArray`, `computeSkewAngle`, `applyRotation`, `loadImage`, `processAndRelease`, `processImage` |
| `app/imaging/scanner.test.js` | Unit tests for pure computation functions | VERIFIED | 6 tests, all passing (`node --test`): 3 for `computeSkewAngle`, 3 for `applyAdaptiveThresholdToArray` |
| `app/imaging/ocr.js` | OCR module with lazy Tesseract and field parsing | VERIFIED | 60 lines; exports `runOCR` and `parseInvoiceFields`; `ensureTesseract()` injects script dynamically — Tesseract is NOT in index.html |
| `app/imaging/ocr.test.js` | Unit tests for parseInvoiceFields | VERIFIED | 9 tests, all passing (`node --test`): full match, alternate unit formats, no-data, partial data, US date format, multi-keyword priority |
| `index.html` | jsPDF 4.2.0 CDN reference | VERIFIED | Line 19: `https://cdn.jsdelivr.net/npm/jspdf@4.2.0/dist/jspdf.umd.min.js`; old `@2.5.2` reference is gone |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/views/upload.js` | `app/imaging/scanner.js` | `import { processAndRelease, loadImage }` | WIRED | Line 9 of upload.js; both functions are called in `handleCameraCapture` |
| `app/views/upload.js` | `app/imaging/ocr.js` | `import { runOCR }` | WIRED | Line 10 of upload.js; `runOCR(blob)` called in `handleCameraCapture` lines 277-279 |
| `app/imaging/ocr.js` | Tesseract CDN | Dynamic script injection in `ensureTesseract()` | WIRED | Line 12 of ocr.js: `s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'`; confirmed absent from index.html |
| `processImage()` | deskew pipeline | `computeSkewAngle` + `applyRotation` called inside `processImage` | WIRED | Lines 319-345 of scanner.js: angle computed, rotation applied, corners re-detected if rotation > 1 degree |
| `perspectiveWarp()` | coordinate clamping fix | `Math.max(0, Math.min(...))` instead of `continue` | WIRED | Lines 154-155 of scanner.js: `cx` and `cy` clamp coordinates; the old `continue` skip is gone |
| `sw.js` | `app/imaging/scanner.js` | STATIC cache array | WIRED | Line 13 of sw.js |
| `sw.js` | `app/imaging/ocr.js` | STATIC cache array | WIRED | Line 14 of sw.js |
| `state.js` | Blob[] type for scanPages | Comment annotation | WIRED | Line 14: `scanPages: [],   // Blob[] — processed JPEG blobs, NOT canvas objects` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCAN-01 | 02-01-PLAN | Image converted to B&W with high contrast | SATISFIED (automated) | `applyAdaptiveThreshold` exists, uses integral-image adaptive threshold, called at end of `processImage()`; 3 unit tests pass |
| SCAN-02 | 02-01-PLAN | Crooked photos automatically deskewed | SATISFIED (automated) | `computeSkewAngle` + `applyRotation` integrated into `processImage()`; re-detects corners after rotation; unit tests for `computeSkewAngle` pass |
| SCAN-03 | 02-02-PLAN | Canvas memory released to prevent iOS crashes | SATISFIED (automated) | `processAndRelease` calls `canvas.width = 0; canvas.height = 0`; `buildPdfFromPages` uses `createImageBitmap` + `bmp.close()` + `tmp.width = 0`; `state.scanPages` stores Blobs |
| SCAN-04 | 02-01-PLAN | jsPDF upgraded to 4.2.0 | SATISFIED (automated) | `index.html` line 19 references `jspdf@4.2.0`; `@2.5.2` is not present anywhere |
| OCR-01 | 02-02-PLAN | Tesseract.js extracts text from scanned invoice | NEEDS HUMAN | `runOCR` correctly calls `Tesseract.createWorker('eng')` and `_worker.recognize(imageBlob)`; accuracy on real invoices requires device test |
| OCR-02 | 02-02-PLAN | OCR auto-fills unit number, date, and maintenance type | NEEDS HUMAN | `prefillFormFields` sets `unitNum`, `serviceDate`, `serviceType`; called from `runOCR` result; field-matching accuracy needs real test |
| OCR-03 | 02-02-PLAN | User can confirm or correct OCR-detected fields before upload | NEEDS HUMAN | Guard logic (`!field.value`) prevents overwriting user-typed values; form fields remain editable; interactive behaviour needs browser confirmation |

All 7 requirements are addressed and covered by at least one plan. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/views/upload.js` | 92, 118, 129 | `placeholder=` HTML attribute | Info | HTML `placeholder` attributes on input fields — not code stubs, expected UI behaviour |

No code stubs, empty implementations, unconnected functions, or TODO/FIXME comments found in any phase 2 file.

---

### Human Verification Required

The following 5 tests must be performed in a real browser/device. Automated checks cannot assess these because they depend on visual output quality, real image content, or iOS-specific memory behaviour.

#### 1. B&W Document Quality (SCAN-01)

**Test:** Open the app on a phone, tap "Scan document", photograph a printed invoice.
**Expected:** Result looks like a high-contrast black-and-white scanned document — text is crisp, background is white, no gray areas.
**Why human:** Adaptive threshold output quality is a visual judgment that cannot be assessed from pixel arrays without a real photo as input.

#### 2. Deskew Straightening (SCAN-02)

**Test:** Hold the phone at a deliberate 5-10 degree angle and photograph a document.
**Expected:** Output PDF shows text lines running horizontally; the document is visibly straightened.
**Why human:** Corner detection accuracy depends on actual image content. Rotation outcome requires visual inspection of the output.

#### 3. Memory Stability — 5+ Sequential Scans (SCAN-03)

**Test:** Scan 5 invoices in sequence on an older iPhone (iPhone 8 or SE level).
**Expected:** All 5 scans complete without the app crashing or becoming unresponsive.
**Why human:** iOS canvas GPU memory pressure cannot be simulated programmatically. Only a real device reveals OOM conditions.

#### 4. OCR Field Extraction Accuracy (OCR-01, OCR-02)

**Test:** Scan an invoice that has a visible unit number (e.g. TR-042), a date, and a service type (e.g. "Oil change"). Wait a few seconds after scanning.
**Expected:** Unit #, Date, and Service Type fields are pre-populated with the correct values extracted from the invoice.
**Why human:** Tesseract.js OCR accuracy on real-world invoice images cannot be determined without actual invoice photos in a running browser.

#### 5. OCR Does Not Overwrite User Input (OCR-03)

**Test:** Type a value into the Unit # field manually. Then scan an invoice.
**Expected:** The Unit # field is NOT overwritten. Only empty fields are populated by OCR.
**Why human:** The `prefillFormFields` guard logic is confirmed in code, but correct interactive behaviour (e.g. timing, focus events) requires a live browser session to fully confirm.

---

### Gaps Summary

No gaps found. All automated verifications pass:

- `app/imaging/scanner.js` is substantive (355 lines), exports all required functions, and is wired into `upload.js`.
- `app/imaging/ocr.js` is substantive (60 lines), exports `runOCR` and `parseInvoiceFields`, loads Tesseract lazily, and is wired into `upload.js`.
- `app/imaging/scanner.test.js`: 6/6 tests pass.
- `app/imaging/ocr.test.js`: 9/9 tests pass.
- `index.html` references `jspdf@4.2.0` with `@2.5.2` fully removed.
- `sw.js` caches both `scanner.js` and `ocr.js` in the STATIC array with cache version `camiora-v5`.
- `state.scanPages` is annotated as `Blob[]` and `processAndRelease` releases canvas memory.
- `prefillFormFields` contains the empty-field guard for all three OCR-populated fields.
- No placeholder anti-patterns, empty implementations, or broken wiring found.

Phase 2 goal requires 5 items of human confirmation (visual quality, device memory, OCR accuracy) before it can be considered fully achieved.

---

_Verified: 2026-03-16_
_Verifier: Claude (gsd-verifier)_

/**
 * Upload form view — migrated from renderApp() in app.js.
 * Native ES module. All inline onclick handlers replaced with addEventListener.
 */

import { state } from '../state.js';
import { startLogin, signOut, CONFIG, getValidToken } from '../graph/auth.js';
import { ensureFolder, uploadFile } from '../graph/files.js';
import { processAndRelease, loadImage } from '../imaging/scanner.js';
import { extractInvoice } from '../invoice/extract.js';
import { getMilestonesForCategory } from '../maintenance/milestones.js';
import { batchMarkDone } from '../invoice/batch-milestone.js';
import { getBaseName, buildFolderPath, getServiceLabel } from '../invoice/naming.js';
import { appendInvoiceRecord } from '../invoice/record.js';
import { enqueueUpload } from '../storage/uploadQueue.js';

// Map service type slugs to document type folders
function getDocType(svc) {
  if (svc === 'dot-inspection') return 'DOT Inspection';
  return 'Invoices';
}

// Look up unit Type from fleet roster
function getUnitType(unitId) {
  const unit = state.fleet.units.find(u => u.UnitId === unitId);
  return unit?.Type || '';
}

// Module-level state
let container = null;
let files = [];
let _lastExtraction = null; // last Claude extraction result

// ── Public render entry point ──────────────────────────────────────────────────
export function render(el) {
  container = el;
  if (!state.token) {
    renderAuth();
  } else {
    renderApp();
  }
}

// ── Refresh unit select (called from main.js after fleet data loads) ──────────
export function refreshUnitSelect() {
  const sel = document.getElementById('unitId');
  if (!sel) return;  // upload view not rendered
  const current = sel.value;
  const unitOpts = state.fleet.units.map(u =>
    `<option value="${u.UnitId}"${u.UnitId === current ? ' selected' : ''}>${u.UnitId}</option>`
  ).join('');
  sel.innerHTML = `<option value="">Select unit…</option>${unitOpts}`;
  // Show/update unit detail link
  const unitLink = document.getElementById('unitDetailLink');
  if (unitLink && state.fleet.units.length) {
    const activeId = sel.value || state.fleet.units[0].UnitId;
    unitLink.href = `#unit?id=${activeId}`;
    unitLink.style.display = '';
  }
  updateAll();
}

// ── Auth screen ────────────────────────────────────────────────────────────────
function renderAuth() {
  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-logo">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <path d="M3 17L8 7H16L21 17" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="5.5" cy="18.5" r="2" fill="white"/>
          <circle cx="18.5" cy="18.5" r="2" fill="white"/>
        </svg>
      </div>
      <div>
        <div class="auth-title">Camiora</div>
        <p class="auth-sub" style="margin-top:6px;">Fleet maintenance records</p>
      </div>
      <p class="auth-sub">Sign in with your Microsoft 365 account to upload records directly to OneDrive.</p>
      <button class="auth-btn" data-action="login">
        <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
          <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
          <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
          <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
          <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
        </svg>
        Sign in with Microsoft
      </button>
    </div>`;

  container.querySelector('[data-action="login"]').addEventListener('click', startLogin);
}

// ── Main upload form ───────────────────────────────────────────────────────────
function renderApp() {
  container.innerHTML = `
    <div class="header">
      <div class="logo-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M3 17L8 7H16L21 17" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="5.5" cy="18.5" r="2" fill="white"/>
          <circle cx="18.5" cy="18.5" r="2" fill="white"/>
        </svg>
      </div>
      <div style="flex:1;">
        <div class="logo-text">Camiora</div>
        <div class="logo-sub">Maintenance upload</div>
      </div>
      <button data-action="signout" style="background:none;border:none;font-size:13px;color:var(--text-2);cursor:pointer;padding:6px 10px;border-radius:8px;touch-action:manipulation;">
        Sign out
      </button>
    </div>

    <nav class="section-nav">
      <a href="#upload" class="section-nav-tab active">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Upload
      </a>
      <a href="#dashboard" class="section-nav-tab">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
        </svg>
        Dashboard
      </a>
    </nav>

    <div class="scroll-body">
      <div class="form-body">

        <div class="field">
          <label>Unit</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="select-wrap" style="flex:1;">
              <select id="unitId">
                <option value="">Select unit…</option>
                ${state.fleet.units.length
                  ? state.fleet.units.map(u =>
                      `<option value="${u.UnitId}">${u.UnitId}</option>`
                    ).join('')
                  : ''
                }
              </select>
            </div>
            <a id="unitDetailLink" href="#unit?id=${state.fleet.units.length ? state.fleet.units[0].UnitId : ''}" style="color:var(--green-dark);font-size:13px;text-decoration:none;white-space:nowrap;${state.fleet.units.length ? '' : 'display:none;'}">View unit</a>
          </div>
        </div>

        <div class="field">
          <label>Service type</label>
          <div class="select-wrap">
            <select id="serviceType">
              <option value="">Select…</option>
              <option value="oil-change">Oil change</option>
              <option value="tire-rotation">Tire rotation</option>
              <option value="brake-inspection">Brake inspection</option>
              <option value="dot-inspection">DOT inspection</option>
              <option value="pm-service">PM service</option>
              <option value="engine-repair">Engine repair</option>
              <option value="transmission">Transmission</option>
              <option value="electrical">Electrical</option>
              <option value="ac-service">A/C service</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div class="field" id="otherWrap" style="display:none;">
          <label>Describe service</label>
          <input type="text" id="otherText" placeholder="e.g. suspension-repair"
            autocorrect="off" autocapitalize="none"/>
        </div>

        <div class="row">
          <div class="field">
            <label>Date</label>
            <input type="date" id="serviceDate"/>
          </div>
          <div class="field">
            <label>Cost (opt.)</label>
            <input type="text" id="invoiceCost" placeholder="450.00"
              inputmode="decimal"/>
          </div>
        </div>

        <div class="row">
          <div class="field">
            <label>Vendor (opt.)</label>
            <input type="text" id="invoiceVendor" placeholder="e.g. Fleet Works"
              autocorrect="off"/>
          </div>
          <div class="field">
            <label>Invoice # (opt.)</label>
            <input type="text" id="invoiceNumber" placeholder="e.g. INV-001"
              autocorrect="off" autocapitalize="none"/>
          </div>
        </div>

        <div class="field" id="milestoneTagField" style="display:none;">
          <label>Milestones completed</label>
          <div class="milestone-chips" style="display:flex;gap:8px;overflow-x:auto;padding:4px 0;flex-wrap:wrap;"></div>
        </div>

        <div class="field">
          <label>Documents</label>

          <div class="scan-zone" id="scanZone">
            <div class="drop-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
                  stroke="var(--text-2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="12" cy="13" r="4" stroke="var(--text-2)" stroke-width="1.8"/>
              </svg>
            </div>
            <div class="drop-title">Scan document</div>
            <div class="drop-sub">Take a photo — auto-converts to B&W PDF</div>
          </div>

          <input type="file" id="cameraInput" accept="image/*" capture="environment"
            style="display:none;"/>

          <div class="scan-pages" id="scanPages"></div>

          <div id="scanActions" class="scan-actions" style="display:none;">
            <button class="scan-add-btn" data-action="addmore">+ Add another page</button>
          </div>

          <div class="separator" id="orSeparator" style="display:none;">
            <span>or</span>
          </div>

          <div class="drop-zone" id="dropZone">
            <input type="file" id="fileInput" multiple
              accept=".pdf,application/pdf"/>
            <div class="drop-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="2" width="14" height="20" rx="2" stroke="var(--text-2)" stroke-width="1.8" fill="none"/>
                <path d="M9 8h6M9 12h6M9 16h4" stroke="var(--text-2)" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="drop-title">Pick existing PDF</div>
            <div class="drop-sub">Already have the file? Select it here</div>
          </div>

          <div class="file-list" id="fileList"></div>
        </div>

        <div id="extractionResults" class="extraction-results" style="display:none;">
          <div class="extraction-results-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span id="extractionStatusText">Extracting invoice data…</span>
          </div>
          <div id="extractionBody"></div>
        </div>

        <div id="previewBox" class="preview-box" style="display:none;">
          <div class="preview-label">Will upload as</div>
          <div class="preview-name" id="previewName"></div>
          <div class="preview-path" id="previewPath"></div>
        </div>

      </div>
    </div>

    <div class="footer-cta">
      <button class="submit-btn" id="submitBtn" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
            stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Upload to OneDrive
      </button>
    </div>

    <div class="toast" id="toast"></div>`;

  // Set today's date
  document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];

  // ── Attach event listeners (replaces inline handlers) ──────────────────────
  container.querySelector('[data-action="signout"]').addEventListener('click', () => {
    signOut();
    renderAuth();
  });

  container.querySelector('#unitId').addEventListener('change', (e) => {
    updateAll();
    renderMilestoneChips(e.target.value, []);
  });
  container.querySelector('#serviceType').addEventListener('change', updateAll);
  container.querySelector('#otherText').addEventListener('input', updateAll);
  container.querySelector('#serviceDate').addEventListener('input', updateAll);
  container.querySelector('#invoiceCost').addEventListener('input', updateAll);
  container.querySelector('#invoiceVendor').addEventListener('input', updateAll);
  container.querySelector('#invoiceNumber').addEventListener('input', updateAll);

  container.querySelector('#scanZone').addEventListener('click', openCamera);
  container.querySelector('#cameraInput').addEventListener('change', (e) => {
    handleCameraCapture(e.target);
  });

  container.querySelector('#fileInput').addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });

  container.querySelector('[data-action="addmore"]').addEventListener('click', addMorePages);

  container.querySelector('#submitBtn').addEventListener('click', handleSubmit);

  // Drop zone drag-and-drop
  const dz = container.querySelector('#dropZone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.style.borderColor = 'var(--green-mid)'; });
  dz.addEventListener('dragleave', ()  => { dz.style.borderColor = ''; });
  dz.addEventListener('drop',      e  => { e.preventDefault(); dz.style.borderColor = ''; handleFiles(e.dataTransfer.files); });

  // Scan pages and file list use event delegation for dynamic items
  container.querySelector('#scanPages').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-action="removescan"]');
    if (removeBtn) {
      removeScanPage(parseInt(removeBtn.dataset.index, 10));
    }
  });

  container.querySelector('#fileList').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-action="removefile"]');
    if (removeBtn) {
      removeFile(parseInt(removeBtn.dataset.index, 10));
    }
  });

  // Milestone chip toggle delegation
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-action="toggle-milestone"]');
    if (chip) chip.classList.toggle('selected');
  });
}

// ── Milestone tag picker ──────────────────────────────────────────────────────

/**
 * Render the milestone chip row for the given unit.
 * AI-detected milestones are pre-selected.
 * @param {string} unitId - the selected unit ID
 * @param {string[]} preselected - milestone types to pre-select (from AI extraction)
 */
function renderMilestoneChips(unitId, preselected = []) {
  const field = document.getElementById('milestoneTagField');
  if (!field) return;

  const chipsEl = field.querySelector('.milestone-chips');
  if (!chipsEl) return;

  const unit = state.fleet.units.find(u => u.UnitId === unitId);
  const unitType = unit?.Type || '';
  const milestones = getMilestonesForCategory(unitType);

  if (!milestones || milestones.length === 0) {
    field.style.display = 'none';
    chipsEl.innerHTML = '';
    return;
  }

  const preselectedSet = new Set(preselected);

  chipsEl.innerHTML = milestones.map(ms => {
    const selected = preselectedSet.has(ms.type);
    return `<button class="milestone-chip${selected ? ' selected' : ''}" data-milestone="${ms.type}" data-action="toggle-milestone">${ms.label}</button>`;
  }).join('');

  field.style.display = 'block';
}

// ── Scanner: open camera ─────────────────────────────────────────────────────
function openCamera() {
  const input = document.getElementById('cameraInput');
  input.value = '';
  input.click();
}

async function handleCameraCapture(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];

  const zone = document.getElementById('scanZone');
  const origHTML = zone.innerHTML;

  // Show processing state
  zone.innerHTML = `<div class="scan-processing"><div class="scan-spinner"></div><div>Processing…</div></div>`;
  zone.style.pointerEvents = 'none';

  try {
    const img = await loadImage(file);
    const { scannedBlob } = await processAndRelease(img);
    state.scanPages.push(scannedBlob);
    renderScanPages();
    await buildPdfFromPages();
    // Extraction fires after PDF is assembled (non-blocking)
    triggerExtractionFromScan();
  } catch (err) {
    console.error('Scan error:', err);
    showToast('Failed to process image', 'error');

    zone.innerHTML = origHTML;
    zone.style.pointerEvents = '';
  }
}

/**
 * Run extraction on the assembled scanned PDF (the last entry in files[] with
 * name 'scanned-document.pdf'). Non-blocking — form fields auto-fill on success.
 */
function triggerExtractionFromScan() {
  const pdfFile = files.find(f => f.name === 'scanned-document.pdf');
  if (!pdfFile) return;

  const fleetIds = state.fleet.units.map(u => u.UnitId).filter(Boolean);
  showExtractionLoading();

  extractInvoice(pdfFile, 'application/pdf', fleetIds)
    .then(data => prefillExtractionFields(data))
    .catch(err => {
      console.error('Extraction failed:', err);
      hideExtractionResults();
      showToast('Auto-fill unavailable \u2014 fill fields manually', 'error');
    });
}

// Track blob object URLs so we can revoke them on re-render (prevent memory leaks)
let _scanPageURLs = [];

// ── Scan pages UI ─────────────────────────────────────────────────────────────
function renderScanPages() {
  const pagesEl   = document.getElementById('scanPages');
  const actions   = document.getElementById('scanActions');
  const separator = document.getElementById('orSeparator');

  // Revoke previous object URLs
  _scanPageURLs.forEach(url => URL.revokeObjectURL(url));
  _scanPageURLs = [];

  if (!state.scanPages.length) {
    pagesEl.innerHTML = '';
    actions.style.display = 'none';
    separator.style.display = 'none';
    return;
  }

  actions.style.display = 'flex';
  separator.style.display = 'flex';

  pagesEl.innerHTML = state.scanPages.map((blob, i) => {
    const url = URL.createObjectURL(blob);
    _scanPageURLs.push(url);
    return `<div class="scan-page">
      <img src="${url}" alt="Page ${i + 1}"/>
      <div class="scan-page-num">${i + 1}</div>
      <div class="scan-page-remove" data-action="removescan" data-index="${i}">×</div>
    </div>`;
  }).join('');
}

function removeScanPage(i) {
  state.scanPages.splice(i, 1);
  renderScanPages();
  if (state.scanPages.length) {
    buildPdfFromPages();
  } else {
    files = files.filter(f => f.name !== 'scanned-document.pdf');
    renderFileList();
    updateAll();
  }
}

async function addMorePages() {
  files = files.filter(f => f.name !== 'scanned-document.pdf');
  openCamera();
}

async function buildPdfFromPages() {
  if (!state.scanPages.length) return;

  const { jsPDF } = window.jspdf;

  // Load first blob to get dimensions
  const firstBmp = await createImageBitmap(state.scanPages[0]);
  const firstW = firstBmp.width;
  const firstH = firstBmp.height;
  firstBmp.close();

  const landscape = firstW > firstH;
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [firstW, firstH],
  });

  for (let i = 0; i < state.scanPages.length; i++) {
    const bmp = await createImageBitmap(state.scanPages[i]);
    const bmpW = bmp.width;
    const bmpH = bmp.height;

    if (i > 0) {
      pdf.addPage([bmpW, bmpH], bmpW > bmpH ? 'landscape' : 'portrait');
    }

    // Draw to temp canvas, extract data URL, release immediately
    const tmp = document.createElement('canvas');
    tmp.width = bmpW;
    tmp.height = bmpH;
    tmp.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();  // release ImageBitmap

    const imgData = tmp.toDataURL('image/jpeg', 0.8);
    tmp.width = 0;  // release temp canvas memory
    tmp.height = 0;

    pdf.addImage(imgData, 'JPEG', 0, 0, bmpW, bmpH);
  }

  const blob = pdf.output('blob');
  const pdfFile = new File([blob], 'scanned-document.pdf', { type: 'application/pdf' });

  files = files.filter(f => f.name !== 'scanned-document.pdf');
  files.push(pdfFile);

  const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
  showToast(`PDF created (${sizeMB} MB, ${state.scanPages.length} page${state.scanPages.length > 1 ? 's' : ''})`, 'success');

  renderFileList();
  updateAll();
}

// ── File handling ─────────────────────────────────────────────────────────────
function handleFiles(newFiles) {
  for (const f of newFiles) files.push(f);
  renderFileList();
  updateAll();

  // Run extraction on the first added file (best-effort, non-blocking)
  const first = newFiles[0];
  if (first) {
    const fleetIds = state.fleet.units.map(u => u.UnitId).filter(Boolean);
    const mimeType = first.type || 'application/pdf';
    showExtractionLoading();

    extractInvoice(first, mimeType, fleetIds)
      .then(data => prefillExtractionFields(data))
      .catch(err => {
        console.error('Extraction failed:', err);
        hideExtractionResults();
        showToast('Auto-fill unavailable \u2014 fill fields manually', 'error');
      });
  }
}

function removeFile(i) {
  files.splice(i, 1);
  renderFileList();
  updateAll();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  if (!list) return;
  if (!files.length) { list.innerHTML = ''; return; }

  list.innerHTML = files.map((f, i) => {
    const name  = getBaseNameFromForm(i);
    const ext   = f.name.split('.').pop();
    return `<div class="file-item">
      <div class="file-thumb">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="3" y="1" width="12" height="16" rx="2" stroke="var(--text-3)" stroke-width="1.2"/>
          <path d="M6 6h6M6 9h6M6 12h4" stroke="var(--text-3)" stroke-width="1"/>
        </svg>
      </div>
      <div class="file-info">
        <div class="file-orig">${f.name}</div>
        ${name ? `<div class="file-new">${name}.${ext}</div>` : ''}
      </div>
      <div class="file-remove" data-action="removefile" data-index="${i}">×</div>
    </div>`;
  }).join('');
}

// ── Naming ────────────────────────────────────────────────────────────────────
function getBaseNameFromForm(i) {
  const unitId = document.getElementById('unitId')?.value || '';
  const svc = getServiceLabel(
    document.getElementById('serviceType')?.value || '',
    document.getElementById('otherText')?.value || ''
  );
  const date = document.getElementById('serviceDate')?.value || '';
  if (!unitId || !svc || !date) return null;
  const name = getBaseName(unitId, svc, date);
  if (files.length > 1 && name) return `${name}-${i + 1}`;
  return name;
}

function updateAll() {
  const st = document.getElementById('serviceType')?.value || '';
  const ow = document.getElementById('otherWrap');
  if (ow) ow.style.display = st === 'other' ? 'flex' : 'none';

  const unitId = document.getElementById('unitId')?.value || '';
  const svc = getServiceLabel(st, document.getElementById('otherText')?.value || '');
  const date = document.getElementById('serviceDate')?.value || '';

  // Update "View unit" link
  const unitLink = document.getElementById('unitDetailLink');
  if (unitLink) {
    if (unitId) {
      unitLink.href = `#unit?id=${unitId}`;
      unitLink.style.display = '';
    } else {
      unitLink.style.display = 'none';
    }
  }

  const preview = document.getElementById('previewBox');
  if (preview) {
    if (unitId && svc && date) {
      const extra = files.length > 1 ? ` (+${files.length - 1} more)` : '';
      document.getElementById('previewName').textContent =
        `${getBaseName(unitId, svc, date)}${files.length > 1 ? '-1' : ''}.pdf${extra}`;
      const docType = getDocType(svc);
      const unitType = getUnitType(unitId);
      document.getElementById('previewPath').textContent =
        `OneDrive / ${buildFolderPath(unitId, { type: unitType, date, docType }).replace(/\//g, ' / ')} /`;
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  }

  const btn = document.getElementById('submitBtn');
  if (btn) btn.disabled = !(unitId && svc && date && files.length) || state.isUploading;

  renderFileList();
}

// ── Claude extraction results display ─────────────────────────────────────────

function showExtractionLoading() {
  const box = document.getElementById('extractionResults');
  const statusText = document.getElementById('extractionStatusText');
  const body = document.getElementById('extractionBody');
  if (!box) return;
  if (statusText) statusText.textContent = 'Extracting invoice data\u2026';
  if (body) body.innerHTML = '<div class="extraction-spinner"><div class="scan-spinner"></div></div>';
  box.style.display = 'block';
}

function hideExtractionResults() {
  const box = document.getElementById('extractionResults');
  if (box) box.style.display = 'none';
}

/**
 * Fill form fields from Claude extraction result (only empty fields).
 * Displays summary, line items, and cost breakdown in the extraction results panel.
 *
 * @param {object} data - Extraction result from Worker
 */
function prefillExtractionFields(data) {
  if (!data) return;
  _lastExtraction = data;

  // ── Auto-fill form fields (never overwrite user input) ────────────────────

  // Unit number — match against fleet roster
  if (data.unit_number) {
    const sel = document.getElementById('unitId');
    if (sel) {
      const match = state.fleet.units.find(u =>
        u.UnitId === String(data.unit_number)
      ) || state.fleet.units.find(u =>
        u.UnitId && u.UnitId.includes(String(data.unit_number))
      );
      if (match) {
        sel.value = match.UnitId;
        // Update the "View unit" link
        const link = document.getElementById('unitDetailLink');
        if (link) { link.href = `#unit?id=${encodeURIComponent(match.UnitId)}`; link.style.display = ''; }
      }
    }
  }

  // Date — normalize to ISO format
  if (data.date) {
    const dateInput = document.getElementById('serviceDate');
    if (dateInput) {
      let isoDate = data.date;
      const slashMatch = data.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slashMatch) {
        const [, m, d, y] = slashMatch;
        isoDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      dateInput.value = isoDate;
    }
  }

  // Cost
  if (data.total_cost != null) {
    const costInput = document.getElementById('invoiceCost');
    if (costInput) costInput.value = String(data.total_cost);
  }

  // Vendor
  if (data.vendor) {
    const vendorInput = document.getElementById('invoiceVendor');
    if (vendorInput) vendorInput.value = data.vendor;
  }

  // Invoice number
  if (data.invoice_number) {
    const numInput = document.getElementById('invoiceNumber');
    if (numInput) numInput.value = data.invoice_number;
  }

  // Service type — map Claude's detected milestones to the select dropdown
  if (data.detected_milestones?.length) {
    const svcSel = document.getElementById('serviceType');
    if (svcSel) {
      // Map milestone types to select option values
      const milestoneToService = {
        'PM': 'pm-service',
        'oil-change': 'oil-change',
        'brake-inspection': 'brake-inspection',
        'dot-inspection': 'dot-inspection',
        'engine-repair': 'engine-repair',
        'transmission-oil': 'transmission',
        'differential-oil': 'oil-change',
        'electrical': 'electrical',
        'ac-service': 'ac-service',
      };
      // Pick the first matching service type for the dropdown
      for (const ms of data.detected_milestones) {
        const svcVal = milestoneToService[ms];
        if (svcVal && svcSel.querySelector(`option[value="${svcVal}"]`)) {
          svcSel.value = svcVal;
          break;
        }
      }
      // If multiple milestones detected but no dropdown match, use "other" with summary
      if (!svcSel.value && data.summary) {
        svcSel.value = 'other';
        const otherWrap = document.getElementById('otherWrap');
        const otherText = document.getElementById('otherText');
        if (otherWrap) otherWrap.style.display = '';
        if (otherText) otherText.value = data.detected_milestones.join(', ');
      }
    }
  }

  // ── Milestone tag picker — pre-select AI-detected milestones ─────────────
  {
    const unitSel = document.getElementById('unitId');
    const currentUnitId = unitSel ? unitSel.value : '';
    renderMilestoneChips(currentUnitId, data.detected_milestones || []);
  }

  // ── Extraction results display panel ─────────────────────────────────────

  const box = document.getElementById('extractionResults');
  const statusText = document.getElementById('extractionStatusText');
  const body = document.getElementById('extractionBody');
  if (!box || !body) return;

  if (statusText) statusText.textContent = 'Detected from invoice';

  const parts = [];

  // Summary
  if (data.summary) {
    parts.push(`<div class="extraction-summary">${escapeHtml(data.summary)}</div>`);
  }

  // Low confidence warning
  if (typeof data.confidence === 'number' && data.confidence < 0.7) {
    parts.push(`<div class="extraction-warn">Low confidence \u2014 please verify fields</div>`);
  }

  // Cost breakdown
  if (data.labor_cost != null || data.parts_cost != null) {
    const rows = [];
    if (data.labor_cost != null) rows.push(`<span>Labor: $${data.labor_cost.toFixed(2)}</span>`);
    if (data.parts_cost  != null) rows.push(`<span>Parts: $${data.parts_cost.toFixed(2)}</span>`);
    if (data.total_cost  != null) rows.push(`<span>Total: $${data.total_cost.toFixed(2)}</span>`);
    parts.push(`<div class="extraction-breakdown">${rows.join('<span class="extraction-sep"> · </span>')}</div>`);
  }

  // Line items
  if (data.line_items && data.line_items.length) {
    const items = data.line_items.map(item =>
      `<li><span class="li-desc">${escapeHtml(item.description)}</span><span class="li-amount">$${Number(item.amount).toFixed(2)}</span></li>`
    ).join('');
    parts.push(`<ul class="extraction-line-items">${items}</ul>`);
  }

  body.innerHTML = parts.join('') || '<div class="extraction-empty">No details extracted</div>';
  box.style.display = 'block';

  updateAll();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── OneDrive upload (submit handler) ─────────────────────────────────────────
async function handleSubmit() {
  if (state.isUploading) return;
  state.isUploading = true;

  const btn = document.getElementById('submitBtn');
  const unitId = document.getElementById('unitId').value;
  const svc = getServiceLabel(
    document.getElementById('serviceType').value,
    document.getElementById('otherText')?.value || ''
  );
  const date = document.getElementById('serviceDate').value;
  const cost = (document.getElementById('invoiceCost')?.value || '').trim().replace(/,/g, '');
  const vendor = (document.getElementById('invoiceVendor')?.value || '').trim();
  const invoiceNumber = (document.getElementById('invoiceNumber')?.value || '').trim();
  const docType = getDocType(svc);
  const unitType = getUnitType(unitId);
  const folderPath = buildFolderPath(unitId, { type: unitType, date, docType });

  // ── Offline guard: queue uploads when no connectivity ──────────────────────
  if (!navigator.onLine) {
    try {
      for (let i = 0; i < files.length; i++) {
        const name = getBaseNameFromForm(i);
        const ext = files[i].name.split('.').pop();
        const fileName = `${name}.${ext}`;
        await enqueueUpload({
          pdfBlob: files[i],
          remotePath: `${folderPath}/${fileName}`,
          folderPath,
          csvRow: {
            InvoiceId: Date.now().toString(36) + i,
            UnitId: unitId,
            Date: date,
            Type: svc,
            Cost: cost,
            Vendor: vendor,
            InvoiceNumber: invoiceNumber,
            Summary: _lastExtraction?.summary || '',
            PdfPath: `${folderPath}/${fileName}`,
          },
        });
      }
      showToast('Offline \u2014 upload queued. Will retry when connected.', 'success');
    } catch (qErr) {
      console.error('Queue save failed:', qErr);
      showToast('Failed to save upload for later', 'error');
    }
    // Reset form (same cleanup as success path)
    files = [];
    state.scanPages = [];
    document.getElementById('invoiceCost').value = '';
    document.getElementById('serviceType').value = '';
    document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('invoiceVendor').value = '';
    document.getElementById('invoiceNumber').value = '';
    hideExtractionResults();
    state.isUploading = false;
    updateAll();
    return;
  }

  btn.innerHTML = `
    <svg class="progress-ring" width="24" height="24" viewBox="0 0 24 24">
      <circle class="progress-track" cx="12" cy="12" r="9"/>
      <circle class="progress-fill" cx="12" cy="12" r="9"
        stroke-dasharray="56.5" stroke-dashoffset="56.5" id="progressArc"/>
    </svg>
    Uploading\u2026`;
  btn.disabled = true;

  try {
    await ensureFolder(folderPath);

    let lastFileName = '';
    for (let i = 0; i < files.length; i++) {
      const name     = getBaseNameFromForm(i);
      const ext      = files[i].name.split('.').pop();
      const fileName = `${name}.${ext}`;
      lastFileName = fileName;
      await uploadFile(files[i], `${folderPath}/${fileName}`);

      const arc = document.getElementById('progressArc');
      if (arc) arc.style.strokeDashoffset = 56.5 * (1 - (i + 1) / files.length);
    }

    // Append invoice record (non-fatal if this fails)
    const invoiceRow = {
      InvoiceId:     Date.now().toString(36),
      UnitId:        unitId,
      Date:          date,
      Type:          svc,
      Cost:          cost,
      Vendor:        vendor,
      InvoiceNumber: invoiceNumber,
      Summary:       _lastExtraction?.summary || '',
      PdfPath:       `${folderPath}/${lastFileName}`,
    };
    try {
      const recToken = await getValidToken();
      if (!recToken) {
        showToast('Session expired \u2014 please sign in again', 'error');
        return;
      }
      await appendInvoiceRecord(invoiceRow, recToken, state.fleet.invoicesPath);
    } catch (csvErr) {
      console.error('CSV append failed:', csvErr);
      showToast('Uploaded - invoice record could not be saved', 'warning');
    }

    // Batch-reset selected milestone tags (non-fatal — upload already succeeded)
    try {
      const selectedTags = [...document.querySelectorAll('.milestone-chip.selected')].map(el => el.dataset.milestone);
      if (selectedTags.length > 0) {
        const milestoneToken = await getValidToken();
        const condRow = state.fleet.condition && state.fleet.condition.find(c => c.UnitId === unitId);
        const currentMiles = condRow ? (condRow.CurrentMiles || '') : '';
        if (milestoneToken && state.fleet.maintenancePath) {
          await batchMarkDone(selectedTags, unitId, date, currentMiles, milestoneToken, state.fleet.maintenancePath);
        }
      }
    } catch (milestoneErr) {
      console.warn('Milestone reset failed (non-fatal):', milestoneErr);
      showToast('Uploaded \u2014 milestone update failed, try again', 'warning');
    }

    showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success');
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M5 12l5 5L20 7" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg> Done`;
    btn.style.background = 'var(--green-dark)';

    setTimeout(() => {
      files = [];
      state.scanPages = [];
      document.getElementById('invoiceCost').value = '';
      document.getElementById('serviceType').value = '';
      document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('invoiceVendor').value = '';
      document.getElementById('invoiceNumber').value = '';
      hideExtractionResults();
      state.isUploading = false;
      btn.style.background = '';
      updateAll();
    }, 2500);

  } catch (err) {
    // Network error (TypeError from fetch) — fall through to queue
    if (err instanceof TypeError) {
      try {
        for (let i = 0; i < files.length; i++) {
          const name = getBaseNameFromForm(i);
          const ext = files[i].name.split('.').pop();
          const fileName = `${name}.${ext}`;
          await enqueueUpload({
            pdfBlob: files[i],
            remotePath: `${folderPath}/${fileName}`,
            folderPath,
            csvRow: {
              InvoiceId: Date.now().toString(36) + i,
              UnitId: unitId,
              Date: date,
              Type: svc,
              Cost: cost,
              Vendor: vendor,
              InvoiceNumber: invoiceNumber,
              Summary: _lastExtraction?.summary || '',
              PdfPath: `${folderPath}/${fileName}`,
            },
          });
        }
        showToast('Connection lost \u2014 upload queued. Will retry when connected.', 'success');
        files = [];
        state.scanPages = [];
        document.getElementById('invoiceCost').value = '';
        document.getElementById('serviceType').value = '';
        document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('invoiceVendor').value = '';
        document.getElementById('invoiceNumber').value = '';
        state.isUploading = false;
        updateAll();
        return;
      } catch (qErr) {
        console.error('Queue save failed:', qErr);
      }
    }

    console.error(err);
    showToast('Upload failed \u2014 check connection', 'error');
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
          stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg> Upload to OneDrive`;
    btn.disabled = false;
    state.isUploading = false;
    updateAll();
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 3500);
}

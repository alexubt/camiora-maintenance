/**
 * Upload form view — migrated from renderApp() in app.js.
 * Native ES module. All inline onclick handlers replaced with addEventListener.
 */

import { state } from '../state.js';
import { startLogin, signOut, CONFIG } from '../graph/auth.js';
import { ensureFolder, uploadFile } from '../graph/files.js';
import { processImage } from '../imaging/scanner.js';

// Module-level state
let container = null;
let files = [];

// ── Public render entry point ──────────────────────────────────────────────────
export function render(el) {
  container = el;
  if (!state.token) {
    renderAuth();
  } else {
    renderApp();
  }
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

    <div class="scroll-body">
      <div class="form-body">

        <div class="row">
          <div class="field">
            <label>Unit type</label>
            <div class="select-wrap">
              <select id="unitType">
                <option value="">Type…</option>
                <option value="Trucks">Truck</option>
                <option value="Trailers">Trailer</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>Unit #</label>
            <input type="text" id="unitNum" placeholder="042"
              inputmode="numeric" autocomplete="off" style="letter-spacing:1px;"/>
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
            <label>Mileage (opt.)</label>
            <input type="text" id="mileage" placeholder="124500"
              inputmode="numeric"/>
          </div>
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

  container.querySelector('#unitType').addEventListener('change', updateAll);
  container.querySelector('#unitNum').addEventListener('input', updateAll);
  container.querySelector('#serviceType').addEventListener('change', updateAll);
  container.querySelector('#otherText').addEventListener('input', updateAll);
  container.querySelector('#serviceDate').addEventListener('input', updateAll);
  container.querySelector('#mileage').addEventListener('input', updateAll);

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

  // Show processing state
  const zone = document.getElementById('scanZone');
  const origHTML = zone.innerHTML;
  zone.innerHTML = `<div class="scan-processing"><div class="scan-spinner"></div><div>Processing…</div></div>`;
  zone.style.pointerEvents = 'none';

  try {
    const img = await loadImage(file);
    const processed = processImage(img);
    state.scanPages.push(processed);
    renderScanPages();

    // Auto-create PDF immediately (single page scan)
    await buildPdfFromPages();
  } catch (err) {
    console.error('Scan error:', err);
    showToast('Failed to process image', 'error');
  }

  zone.innerHTML = origHTML;
  zone.style.pointerEvents = '';
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ── Scan pages UI ─────────────────────────────────────────────────────────────
function renderScanPages() {
  const pagesEl   = document.getElementById('scanPages');
  const actions   = document.getElementById('scanActions');
  const separator = document.getElementById('orSeparator');

  if (!state.scanPages.length) {
    pagesEl.innerHTML = '';
    actions.style.display = 'none';
    separator.style.display = 'none';
    return;
  }

  actions.style.display = 'flex';
  separator.style.display = 'flex';

  pagesEl.innerHTML = state.scanPages.map((canvas, i) => {
    const thumb = canvas.toDataURL('image/jpeg', 0.3);
    return `<div class="scan-page">
      <img src="${thumb}" alt="Page ${i + 1}"/>
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

  const first = state.scanPages[0];
  const landscape = first.width > first.height;
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [first.width, first.height],
  });

  for (let i = 0; i < state.scanPages.length; i++) {
    const canvas = state.scanPages[i];
    if (i > 0) {
      const l = canvas.width > canvas.height;
      pdf.addPage([canvas.width, canvas.height], l ? 'landscape' : 'portrait');
    }
    const imgData = canvas.toDataURL('image/jpeg', 0.5);
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
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
    const name  = getBaseName(i);
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
function getServiceLabel() {
  const v = document.getElementById('serviceType')?.value || '';
  if (v === 'other') {
    return (document.getElementById('otherText')?.value || '')
      .trim().replace(/\s+/g, '-').toLowerCase() || 'other';
  }
  return v;
}

function getBaseName(i) {
  const type = document.getElementById('unitType')?.value   || '';
  const num  = (document.getElementById('unitNum')?.value   || '').trim();
  const svc  = getServiceLabel();
  const date = document.getElementById('serviceDate')?.value || '';
  const mi   = (document.getElementById('mileage')?.value   || '').trim();
  if (!type || !num || !svc || !date) return null;
  const prefix  = type === 'Trucks' ? 'TR' : 'TL';
  const padded  = num.padStart(3, '0');
  const miPart  = mi ? `_${mi}mi` : '';
  const idxPart = files.length > 1 ? `-${i + 1}` : '';
  return `${prefix}-${padded}_${svc}_${date}${miPart}${idxPart}`;
}

function updateAll() {
  const st = document.getElementById('serviceType')?.value || '';
  const ow = document.getElementById('otherWrap');
  if (ow) ow.style.display = st === 'other' ? 'flex' : 'none';

  const type = document.getElementById('unitType')?.value    || '';
  const num  = (document.getElementById('unitNum')?.value    || '').trim();
  const svc  = getServiceLabel();
  const date = document.getElementById('serviceDate')?.value || '';

  const preview = document.getElementById('previewBox');
  if (preview) {
    if (type && num && svc && date) {
      const prefix = type === 'Trucks' ? 'TR' : 'TL';
      const padded = num.padStart(3, '0');
      const extra  = files.length > 1 ? ` (+${files.length - 1} more)` : '';
      document.getElementById('previewName').textContent =
        `${prefix}-${padded}_${svc}_${date}${files.length > 1 ? '-1' : ''}${extra}`;
      document.getElementById('previewPath').textContent =
        `OneDrive / ${CONFIG.ONEDRIVE_BASE} / ${type} / ${prefix}-${padded} / Maintenance /`;
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  }

  const btn = document.getElementById('submitBtn');
  if (btn) btn.disabled = !(type && num && svc && date && files.length) || state.isUploading;

  renderFileList();
}

// ── OneDrive upload (submit handler) ─────────────────────────────────────────
async function handleSubmit() {
  if (state.isUploading) return;
  state.isUploading = true;

  const btn  = document.getElementById('submitBtn');
  const type = document.getElementById('unitType').value;
  const num  = document.getElementById('unitNum').value.trim().padStart(3, '0');
  const prefix = type === 'Trucks' ? 'TR' : 'TL';
  const folderPath = `${CONFIG.ONEDRIVE_BASE}/${type}/${prefix}-${num}/Maintenance`;

  btn.innerHTML = `
    <svg class="progress-ring" width="24" height="24" viewBox="0 0 24 24">
      <circle class="progress-track" cx="12" cy="12" r="9"/>
      <circle class="progress-fill" cx="12" cy="12" r="9"
        stroke-dasharray="56.5" stroke-dashoffset="56.5" id="progressArc"/>
    </svg>
    Uploading…`;
  btn.disabled = true;

  try {
    await ensureFolder(folderPath);

    for (let i = 0; i < files.length; i++) {
      const name     = getBaseName(i);
      const ext      = files[i].name.split('.').pop();
      const fileName = `${name}.${ext}`;
      await uploadFile(files[i], `${folderPath}/${fileName}`);

      const arc = document.getElementById('progressArc');
      if (arc) arc.style.strokeDashoffset = 56.5 * (1 - (i + 1) / files.length);
    }

    showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success');
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M5 12l5 5L20 7" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg> Done`;
    btn.style.background = 'var(--green-dark)';

    setTimeout(() => {
      files = [];
      ['unitNum','mileage'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('serviceType').value = '';
      document.getElementById('unitType').value = '';
      document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];
      state.isUploading = false;
      btn.style.background = '';
      updateAll();
    }, 2500);

  } catch (err) {
    console.error(err);
    showToast('Upload failed — check connection', 'error');
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

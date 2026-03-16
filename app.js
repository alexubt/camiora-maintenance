// ── CONFIG — fill in before deploying ────────────────────────────────────────
const CONFIG = {
  CLIENT_ID:      'd8a6756d-ed3c-4337-8146-bacf2f80ba37',
  TENANT_ID:      'common',       // or 'common' for any M365 org
  REDIRECT_URI:   'https://alexubt.github.io/camiora-maintenance/',  // must match Azure app registration
  ONEDRIVE_BASE:  'Fleet Maintenance',                 // top-level folder in your OneDrive
};
// ─────────────────────────────────────────────────────────────────────────────

const SCOPES = 'Files.ReadWrite User.Read';
const GRAPH  = 'https://graph.microsoft.com/v1.0';

// ── App state ─────────────────────────────────────────────────────────────────
let accessToken = null;
let files       = [];
let isUploading = false;

// ── Auth (PKCE authorization code flow) ──────────────────────────────────────
function generateRandomString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

async function generatePKCE() {
  const verifier = generateRandomString(64);
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

async function startLogin() {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem('pkce_verifier', verifier);

  const p = new URLSearchParams({
    client_id:             CONFIG.CLIENT_ID,
    response_type:         'code',
    redirect_uri:          CONFIG.REDIRECT_URI,
    scope:                 SCOPES,
    response_mode:         'query',
    prompt:                'select_account',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  window.location.href = `https://login.microsoftonline.com/${CONFIG.TENANT_ID}/oauth2/v2.0/authorize?${p}`;
}

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier) return null;

  const body = new URLSearchParams({
    client_id:     CONFIG.CLIENT_ID,
    grant_type:    'authorization_code',
    code:          code,
    redirect_uri:  CONFIG.REDIRECT_URI,
    code_verifier: verifier,
    scope:         SCOPES,
  });

  const resp = await fetch(
    `https://login.microsoftonline.com/${CONFIG.TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  );

  if (!resp.ok) {
    console.error('Token exchange failed', await resp.text());
    return null;
  }

  const data = await resp.json();
  sessionStorage.removeItem('pkce_verifier');
  return data;
}

function saveToken(token, expiresIn) {
  sessionStorage.setItem('ms_token', token);
  sessionStorage.setItem('ms_token_exp', Date.now() + (expiresIn || 3600) * 1000);
  accessToken = token;
}

function loadToken() {
  const token = sessionStorage.getItem('ms_token');
  const exp   = parseInt(sessionStorage.getItem('ms_token_exp') || '0');
  if (token && Date.now() < exp) { accessToken = token; return true; }
  return false;
}

function signOut() {
  sessionStorage.clear();
  accessToken = null;
  renderAuth();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Check for auth code in URL (redirect back from Microsoft)
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    history.replaceState(null, '', window.location.pathname);
    const tokenData = await exchangeCodeForToken(code);
    if (tokenData && tokenData.access_token) {
      saveToken(tokenData.access_token, tokenData.expires_in);
      renderApp();
      return;
    }
  }

  loadToken() ? renderApp() : renderAuth();
});

// ── Auth screen ───────────────────────────────────────────────────────────────
function renderAuth() {
  document.getElementById('app').innerHTML = `
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
      <button class="auth-btn" onclick="startLogin()">
        <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
          <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
          <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
          <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
          <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
        </svg>
        Sign in with Microsoft
      </button>
    </div>`;
}

// ── Main app ──────────────────────────────────────────────────────────────────
function renderApp() {
  document.getElementById('app').innerHTML = `
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
      <button onclick="signOut()" style="background:none;border:none;font-size:13px;color:var(--text-2);cursor:pointer;padding:6px 10px;border-radius:8px;touch-action:manipulation;">
        Sign out
      </button>
    </div>

    <div class="scroll-body">
      <div class="form-body">

        <div class="row">
          <div class="field">
            <label>Unit type</label>
            <div class="select-wrap">
              <select id="unitType" onchange="updateAll()">
                <option value="">Type…</option>
                <option value="Trucks">Truck</option>
                <option value="Trailers">Trailer</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>Unit #</label>
            <input type="text" id="unitNum" placeholder="042"
              inputmode="numeric" autocomplete="off"
              oninput="updateAll()" style="letter-spacing:1px;"/>
          </div>
        </div>

        <div class="field">
          <label>Service type</label>
          <div class="select-wrap">
            <select id="serviceType" onchange="updateAll()">
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
            oninput="updateAll()" autocorrect="off" autocapitalize="none"/>
        </div>

        <div class="row">
          <div class="field">
            <label>Date</label>
            <input type="date" id="serviceDate" oninput="updateAll()"/>
          </div>
          <div class="field">
            <label>Mileage (opt.)</label>
            <input type="text" id="mileage" placeholder="124500"
              inputmode="numeric" oninput="updateAll()"/>
          </div>
        </div>

        <div class="field">
          <label>Documents</label>
          <div class="drop-zone" id="dropZone">
            <input type="file" id="fileInput" multiple
              accept=".pdf,application/pdf"
              onchange="handleFiles(this.files)"/>
            <div class="drop-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="2" width="14" height="20" rx="2" stroke="var(--text-2)" stroke-width="1.8" fill="none"/>
                <path d="M9 8h6M9 12h6M9 16h4" stroke="var(--text-2)" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="drop-title">Tap to select PDF</div>
            <div class="drop-sub">Scan invoices as PDF before uploading</div>
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
      <button class="submit-btn" id="submitBtn" disabled onclick="handleSubmit()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
            stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Upload to OneDrive
      </button>
    </div>

    <div class="toast" id="toast"></div>`;

  document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];

  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.style.borderColor = 'var(--green-mid)'; });
  dz.addEventListener('dragleave', ()  => { dz.style.borderColor = ''; });
  dz.addEventListener('drop',      e  => { e.preventDefault(); dz.style.borderColor = ''; handleFiles(e.dataTransfer.files); });
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
      <div class="file-remove" onclick="removeFile(${i})">×</div>
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
  if (btn) btn.disabled = !(type && num && svc && date && files.length) || isUploading;

  renderFileList();
}

// ── OneDrive upload ───────────────────────────────────────────────────────────
async function ensureFolder(folderPath) {
  const parts = folderPath.split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const res = await fetch(`${GRAPH}/me/drive/root:/${encodeURIComponent(current)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.status === 404) {
      const parent     = current.includes('/') ? current.substring(0, current.lastIndexOf('/')) : '';
      const parentUrl  = parent
        ? `${GRAPH}/me/drive/root:/${encodeURIComponent(parent)}:/children`
        : `${GRAPH}/me/drive/root/children`;
      await fetch(parentUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' })
      });
    }
  }
}

async function uploadFile(file, remotePath) {
  const url  = `${GRAPH}/me/drive/root:/${encodeURIComponent(remotePath)}:/content`;
  const resp = await fetch(url, {
    method:  'PUT',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!resp.ok) throw new Error(`Upload failed ${resp.status}`);
  return resp.json();
}

async function handleSubmit() {
  if (isUploading) return;
  isUploading = true;

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
      isUploading = false;
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
    isUploading  = false;
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

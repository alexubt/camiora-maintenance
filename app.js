// ── CONFIG — fill in before deploying ────────────────────────────────────────
const CONFIG = {
  CLIENT_ID:      'd8a6756d-ed3c-4337-8146-bacf2f80ba37',
  TENANT_ID:      'common',
  REDIRECT_URI:   'https://alexubt.github.io/camiora-maintenance/',
  ONEDRIVE_BASE:  'Fleet Maintenance',
};
// ─────────────────────────────────────────────────────────────────────────────

const SCOPES = 'Files.ReadWrite User.Read';
const GRAPH  = 'https://graph.microsoft.com/v1.0';

// ── App state ─────────────────────────────────────────────────────────────────
let accessToken  = null;
let files        = [];
let isUploading  = false;
let scanPages    = [];   // array of canvas elements (B&W processed scans)

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

          <div class="scan-zone" id="scanZone" onclick="openCamera()">
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
            style="display:none;" onchange="handleCameraCapture(this)"/>

          <div class="scan-pages" id="scanPages"></div>

          <div id="scanActions" class="scan-actions" style="display:none;">
            <button class="scan-add-btn" onclick="addMorePages()">+ Add another page</button>
          </div>

          <div class="separator" id="orSeparator" style="display:none;">
            <span>or</span>
          </div>

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

// ── Scanner: open camera ─────────────────────────────────────────────────────
function openCamera() {
  document.getElementById('cameraInput').value = '';
  document.getElementById('cameraInput').click();
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
    scanPages.push(processed);
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

// ── Image processing: edge detection + B&W ───────────────────────────────────
function processImage(img) {
  const work = document.createElement('canvas');
  const wCtx = work.getContext('2d');
  // Limit to 1200px max dimension — keeps PDF under 500KB per page
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
  work.width  = Math.round(img.width * scale);
  work.height = Math.round(img.height * scale);
  wCtx.drawImage(img, 0, 0, work.width, work.height);

  // Get image data
  const imageData = wCtx.getImageData(0, 0, work.width, work.height);
  const w = work.width;
  const h = work.height;

  // Step 1: Grayscale
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = imageData.data[i * 4];
    const g = imageData.data[i * 4 + 1];
    const b = imageData.data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Step 2: Gaussian blur (5x5)
  const blurred = gaussianBlur(gray, w, h);

  // Step 3: Edge detection (Canny-like with Sobel)
  const edges = sobelEdges(blurred, w, h);

  // Step 4: Find document contour
  const corners = findDocumentCorners(edges, w, h);

  // Step 5: Perspective warp if corners found, otherwise use full image
  let output;
  if (corners) {
    output = perspectiveWarp(work, corners);
  } else {
    output = work;
  }

  // Step 6: Apply adaptive threshold B&W filter for scanned look
  applyAdaptiveThreshold(output);

  return output;
}

function gaussianBlur(gray, w, h) {
  const kernel = [1, 4, 6, 4, 1, 4, 16, 24, 16, 4, 6, 24, 36, 24, 6, 4, 16, 24, 16, 4, 1, 4, 6, 4, 1];
  const out = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let sum = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          sum += gray[(y + ky) * w + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)];
        }
      }
      out[y * w + x] = sum / 256;
    }
  }
  return out;
}

function sobelEdges(gray, w, h) {
  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
        -2 * gray[y * w + (x - 1)]   + 2 * gray[y * w + (x + 1)]
        -gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
        +gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      edges[y * w + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
    }
  }
  return edges;
}

function findDocumentCorners(edges, w, h) {
  // Threshold edges
  const threshold = 50;
  const margin = Math.round(Math.min(w, h) * 0.02);

  // Find edge points along each side to detect document boundary
  // Scan from each edge inward to find the first strong edge line
  const topEdge = [], bottomEdge = [], leftEdge = [], rightEdge = [];

  // Sample columns for top/bottom edges
  const cols = 20;
  for (let ci = 0; ci < cols; ci++) {
    const x = Math.round(margin + (w - 2 * margin) * ci / (cols - 1));
    // Top: scan down
    for (let y = margin; y < h / 2; y++) {
      if (edges[y * w + x] > threshold) { topEdge.push({ x, y }); break; }
    }
    // Bottom: scan up
    for (let y = h - margin - 1; y > h / 2; y--) {
      if (edges[y * w + x] > threshold) { bottomEdge.push({ x, y }); break; }
    }
  }

  // Sample rows for left/right edges
  const rows = 20;
  for (let ri = 0; ri < rows; ri++) {
    const y = Math.round(margin + (h - 2 * margin) * ri / (rows - 1));
    // Left: scan right
    for (let x = margin; x < w / 2; x++) {
      if (edges[y * w + x] > threshold) { leftEdge.push({ x, y }); break; }
    }
    // Right: scan left
    for (let x = w - margin - 1; x > w / 2; x--) {
      if (edges[y * w + x] > threshold) { rightEdge.push({ x, y }); break; }
    }
  }

  // Need enough points to fit lines
  if (topEdge.length < 3 || bottomEdge.length < 3 || leftEdge.length < 3 || rightEdge.length < 3) {
    return null;
  }

  // Fit lines using RANSAC-lite (median of points)
  const fitLine = (points) => {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const mid = Math.floor(points.length / 2);
    // Use endpoints for line
    return { p1: points[0], p2: points[points.length - 1] };
  };

  const top    = fitLine(topEdge);
  const bottom = fitLine(bottomEdge);
  const left   = fitLine(leftEdge);
  const right  = fitLine(rightEdge);

  // Intersect lines to get 4 corners
  const intersect = (l1, l2) => {
    const x1 = l1.p1.x, y1 = l1.p1.y, x2 = l1.p2.x, y2 = l1.p2.y;
    const x3 = l2.p1.x, y3 = l2.p1.y, x4 = l2.p2.x, y4 = l2.p2.y;
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(d) < 0.001) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  };

  const tl = intersect(top, left);
  const tr = intersect(top, right);
  const br = intersect(bottom, right);
  const bl = intersect(bottom, left);

  if (!tl || !tr || !br || !bl) return null;

  // Validate corners are inside image and form a reasonable quad
  const allInside = [tl, tr, br, bl].every(p =>
    p.x >= -w * 0.1 && p.x <= w * 1.1 && p.y >= -h * 0.1 && p.y <= h * 1.1
  );
  if (!allInside) return null;

  // Check quad area is at least 15% of image
  const quadArea = 0.5 * Math.abs(
    (tr.x - tl.x) * (bl.y - tl.y) - (bl.x - tl.x) * (tr.y - tl.y)
  ) + 0.5 * Math.abs(
    (tr.x - br.x) * (bl.y - br.y) - (bl.x - br.x) * (tr.y - br.y)
  );
  if (quadArea < w * h * 0.15) return null;

  return { tl, tr, br, bl };
}

function perspectiveWarp(srcCanvas, corners) {
  const { tl, tr, br, bl } = corners;

  // Output dimensions: max of top/bottom width and left/right height
  const widthTop    = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightLeft  = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);

  const outW = Math.round(Math.max(widthTop, widthBottom));
  const outH = Math.round(Math.max(heightLeft, heightRight));

  const out = document.createElement('canvas');
  out.width  = outW;
  out.height = outH;
  const outCtx = out.getContext('2d');

  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const outData = outCtx.createImageData(outW, outH);

  // Bilinear interpolation with inverse perspective mapping
  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const u = dx / outW;
      const v = dy / outH;

      // Bilinear interpolation of source position from quad corners
      const sx = (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x;
      const sy = (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;

      if (x0 < 0 || x0 >= srcCanvas.width - 1 || y0 < 0 || y0 >= srcCanvas.height - 1) continue;

      const idx = (dy * outW + dx) * 4;
      for (let c = 0; c < 3; c++) {
        const p00 = srcData.data[(y0 * srcCanvas.width + x0) * 4 + c];
        const p10 = srcData.data[(y0 * srcCanvas.width + x0 + 1) * 4 + c];
        const p01 = srcData.data[((y0 + 1) * srcCanvas.width + x0) * 4 + c];
        const p11 = srcData.data[((y0 + 1) * srcCanvas.width + x0 + 1) * 4 + c];
        outData.data[idx + c] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
          p01 * (1 - fx) * fy + p11 * fx * fy
        );
      }
      outData.data[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return out;
}

function applyAdaptiveThreshold(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  // Convert to grayscale
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  }

  // Compute integral image for fast mean calculation
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = rowSum + integral[y * (w + 1) + (x + 1)];
    }
  }

  // Adaptive threshold using local mean
  const blockSize = Math.max(15, Math.round(Math.min(w, h) / 30) | 1);
  const C = 8; // constant subtracted from mean

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.floor(blockSize / 2);
      const y1 = Math.max(0, y - r);
      const y2 = Math.min(h - 1, y + r);
      const x1 = Math.max(0, x - r);
      const x2 = Math.min(w - 1, x + r);

      const area = (y2 - y1 + 1) * (x2 - x1 + 1);
      const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)]
                - integral[y1 * (w + 1) + (x2 + 1)]
                - integral[(y2 + 1) * (w + 1) + x1]
                + integral[y1 * (w + 1) + x1];
      const mean = sum / area;

      const val = gray[y * w + x] > (mean - C) ? 255 : 0;
      const idx = (y * w + x) * 4;
      d[idx] = d[idx + 1] = d[idx + 2] = val;
      d[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ── Scan pages UI ─────────────────────────────────────────────────────────────
function renderScanPages() {
  const container = document.getElementById('scanPages');
  const actions   = document.getElementById('scanActions');
  const separator = document.getElementById('orSeparator');

  if (!scanPages.length) {
    container.innerHTML = '';
    actions.style.display = 'none';
    separator.style.display = 'none';
    return;
  }

  actions.style.display = 'flex';
  separator.style.display = 'flex';

  container.innerHTML = scanPages.map((canvas, i) => {
    const thumb = canvas.toDataURL('image/jpeg', 0.3);
    return `<div class="scan-page">
      <img src="${thumb}" alt="Page ${i + 1}"/>
      <div class="scan-page-num">${i + 1}</div>
      <div class="scan-page-remove" onclick="removeScanPage(${i})">×</div>
    </div>`;
  }).join('');
}

function removeScanPage(i) {
  scanPages.splice(i, 1);
  renderScanPages();
  // Rebuild PDF without that page
  if (scanPages.length) {
    buildPdfFromPages();
  } else {
    // Remove the scanned PDF from files
    files = files.filter(f => f.name !== 'scanned-document.pdf');
    renderFileList();
    updateAll();
  }
}

async function addMorePages() {
  // Remove existing scanned PDF so it gets rebuilt with new pages
  files = files.filter(f => f.name !== 'scanned-document.pdf');
  openCamera();
}

async function buildPdfFromPages() {
  if (!scanPages.length) return;

  const { jsPDF } = window.jspdf;

  // Use A4-ish proportions scaled to canvas size
  const first = scanPages[0];
  const landscape = first.width > first.height;
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [first.width, first.height],
  });

  for (let i = 0; i < scanPages.length; i++) {
    const canvas = scanPages[i];
    if (i > 0) {
      const l = canvas.width > canvas.height;
      pdf.addPage([canvas.width, canvas.height], l ? 'landscape' : 'portrait');
    }
    // B&W images compress well at low quality
    const imgData = canvas.toDataURL('image/jpeg', 0.5);
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
  }

  const blob = pdf.output('blob');
  const pdfFile = new File([blob], 'scanned-document.pdf', { type: 'application/pdf' });

  // Replace any existing scanned PDF in files
  files = files.filter(f => f.name !== 'scanned-document.pdf');
  files.push(pdfFile);

  const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
  showToast(`PDF created (${sizeMB} MB, ${scanPages.length} page${scanPages.length > 1 ? 's' : ''})`, 'success');

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

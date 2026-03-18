/**
 * Boot sequence: SW register, auth check, fleet load, router init.
 * Native ES module — entry point loaded by index.html.
 */

import { loadToken, exchangeCodeForToken, saveToken, getValidToken } from './graph/auth.js';
import { downloadCSV, parseCSV, serializeCSV, hashText } from './graph/csv.js';
import { getCachedFleet, setCachedFleet } from './storage/cache.js';
import { dequeueAll, removeJob } from './storage/uploadQueue.js';
import { ensureFolder, uploadFile } from './graph/files.js';
import { appendInvoiceRecord } from './invoice/record.js';
import { state } from './state.js';
import { initRouter } from './router.js';
import { refreshUnitSelect } from './views/upload.js';
import { initInstallPrompt } from './install.js';
import { UNIT_HEADERS } from './fleet/units.js';
import { buildDefaultConfigCSV, MILESTONE_CONFIG_HEADERS } from './maintenance/milestones.js';

// ── Upload queue drain (retries queued offline uploads) ──────────────────────
async function drainUploadQueue() {
  const token = await getValidToken();
  if (!token) return;

  const jobs = await dequeueAll();
  if (!jobs.length) return;

  for (const job of jobs) {
    try {
      await ensureFolder(job.folderPath);
      const file = new File([job.pdfBlob], job.remotePath.split('/').pop(), { type: 'application/pdf' });
      await uploadFile(file, job.remotePath);
      await appendInvoiceRecord(job.csvRow, token, state.fleet.invoicesPath);
      await removeJob(job.id);

      // Show toast if DOM is ready
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = `Queued upload completed: ${job.remotePath.split('/').pop()}`;
        toast.className = 'toast success';
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => toast.classList.remove('show'), 3500);
      }
    } catch (err) {
      console.warn('Queue drain stopped:', err.message);
      break; // Stop draining, retry on next online event
    }
  }
}

// ── Fleet data loader (background, non-blocking) ─────────────────────────────
async function loadFleetData() {
  // 1. Try cached data first
  try {
    const cached = await getCachedFleet();
    if (cached) {
      state.fleet.units = cached.units;
      state.fleet.unitsHash = cached.hash;
    }
  } catch (err) {
    console.warn('Fleet cache read failed:', err);
  }

  // 2. Try fresh download from OneDrive
  try {
    const token = await getValidToken();
    const { text, hash } = await downloadCSV(state.fleet.unitsPath, token);
    if (text !== null) {
      const units = parseCSV(text);
      state.fleet.units = units;
      state.fleet.unitsHash = hash;
      setCachedFleet({ units, hash }).catch(() => {});
    } else {
      // 404 — file does not exist yet; create blank CSV with header row
      console.log('Fleet CSV not found (404) — initializing blank units.csv');
      const blankCSV = serializeCSV(UNIT_HEADERS, []);
      const encodedPath = state.fleet.unitsPath.split('/').map(encodeURIComponent).join('/');
      const putUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;
      const putResp = await fetch(putUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: blankCSV,
      });
      if (putResp.ok) {
        state.fleet.unitsHash = await hashText(blankCSV);
        console.log('Blank units.csv created on OneDrive');
      }
      state.fleet.units = [];
    }
  } catch (err) {
    // Network error — if we have cached data, silently continue
    if (state.fleet.units.length) {
      console.log('Fleet CSV download failed, using cached data');
    } else {
      console.warn('Fleet CSV unavailable and no cache:', err.message);
    }
  }
}

// ── Milestone config loader ──────────────────────────────────────────────────
async function loadMilestoneConfig() {
  try {
    const token = await getValidToken();
    const { text, hash } = await downloadCSV(state.fleet.milestoneConfigPath, token);
    if (text !== null) {
      state.fleet.milestoneConfig = parseCSV(text);
      state.fleet.milestoneConfigHash = hash;
    } else {
      // 404 — seed the default config on OneDrive
      console.log('milestone-config.csv not found — creating defaults');
      const defaultCSV = buildDefaultConfigCSV();
      const encodedPath = state.fleet.milestoneConfigPath.split('/').map(encodeURIComponent).join('/');
      const putUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;
      await fetch(putUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: defaultCSV,
      });
      state.fleet.milestoneConfig = parseCSV(defaultCSV);
      state.fleet.milestoneConfigHash = await hashText(defaultCSV);
    }
  } catch (err) {
    console.warn('Milestone config load failed, using hardcoded defaults:', err.message);
    state.fleet.milestoneConfig = [];
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Check for OAuth authorization code in URL
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');

  if (code) {
    history.replaceState(null, '', window.location.pathname);
    const tokenData = await exchangeCodeForToken(code);
    if (tokenData && tokenData.access_token) {
      saveToken(tokenData);
    }
  } else {
    loadToken();
  }

  // Initialize router — renders the upload view (which checks state.token)
  const container = document.getElementById('app');
  initRouter(container);
  initInstallPrompt();

  // Register online event listener for queue drain
  window.addEventListener('online', drainUploadQueue);

  // Load fleet data in background if authenticated (do not await — let UI render first)
  if (state.token) {
    Promise.all([loadFleetData(), loadMilestoneConfig()]).then(() => {
      refreshUnitSelect();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      // Drain any leftover queued uploads from previous sessions
      drainUploadQueue();
    });
  }
});

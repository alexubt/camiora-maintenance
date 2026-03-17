/**
 * Boot sequence: SW register, auth check, fleet load, router init.
 * Native ES module — entry point loaded by index.html.
 */

import { loadToken, exchangeCodeForToken, saveToken } from './graph/auth.js';
import { downloadCSV, parseCSV } from './graph/csv.js';
import { getCachedFleet, setCachedFleet } from './storage/cache.js';
import { state } from './state.js';
import { initRouter } from './router.js';

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
    const { text, hash } = await downloadCSV(state.fleet.unitsPath, state.token);
    if (text !== null) {
      const units = parseCSV(text);
      state.fleet.units = units;
      state.fleet.unitsHash = hash;
      setCachedFleet({ units, hash }).catch(() => {});
    } else {
      // 404 — file does not exist yet
      state.fleet.units = [];
      console.log('Fleet CSV not found (404) — units list empty');
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
      saveToken(tokenData.access_token, tokenData.expires_in);
    }
  } else {
    loadToken();
  }

  // Initialize router — renders the upload view (which checks state.token)
  const container = document.getElementById('app');
  initRouter(container);

  // Load fleet data in background if authenticated (do not await — let UI render first)
  if (state.token) {
    loadFleetData();
  }
});

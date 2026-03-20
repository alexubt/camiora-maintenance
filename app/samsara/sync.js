/**
 * Samsara odometer sync — fetches mileage via Cloudflare Worker proxy,
 * batch-updates condition.csv on OneDrive when values change.
 *
 * Native ES module. Self-contained — the rest of the app does not need
 * to know mileage came from Samsara vs manual entry.
 */

import { state } from '../state.js';
import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock } from '../graph/csv.js';
import { getValidToken } from '../graph/auth.js';

// ── Configuration ──────────────────────────────────────────────────────────

const WORKER_URL = 'https://camiora-samsara-proxy.camiora.workers.dev';

const POLL_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const CHANGE_THRESHOLD = 50;              // miles — skip write if delta below this
const CONDITION_HEADERS = ['UnitId', 'CurrentMiles', 'DotExpiry', 'TireNotes', 'LastUpdated'];

let _pollTimer = null;
let _visibilityHandler = null;

// ── Mapping loader (called once at boot) ───────────────────────────────────

export async function loadSamsaraMapping() {
  try {
    const token = await getValidToken();
    if (!token) return;
    const { text } = await downloadCSV(state.fleet.samsaraMappingPath, token);
    const rows = parseCSV(text);  // [] if 404 (parseCSV handles null)
    // Build Map: UnitId → SamsaraVehicleId
    const map = new Map();
    for (const row of rows) {
      if (row.UnitId && row.SamsaraVehicleId) {
        map.set(row.UnitId, row.SamsaraVehicleId.trim());
      }
    }
    state.samsara.mapping = map;
    state.samsara.enabled = map.size > 0;
  } catch (err) {
    console.warn('Samsara mapping load failed (non-fatal):', err.message);
    state.samsara.mapping = new Map();
    state.samsara.enabled = false;
  }
}

// ── Condition cache loader (populates state.fleet.condition at boot) ───────

export async function loadConditionCache() {
  try {
    const token = await getValidToken();
    if (!token) return;
    const { text } = await downloadCSV(state.fleet.conditionPath, token);
    if (text !== null) {
      state.fleet.condition = parseCSV(text);
      state.samsara._conditionLoaded = true;
    }
  } catch (err) {
    console.warn('Condition cache load failed (non-fatal):', err.message);
  }
}

// ── Fetch vehicle stats from Worker proxy ──────────────────────────────────

async function fetchVehicleStats() {
  const url = `${WORKER_URL}/vehicles/stats?types=obdOdometerMeters,gpsOdometerMeters`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Samsara proxy returned ${resp.status}`);
  }
  return resp.json();
}

// ── Build odometer map from Samsara response ───────────────────────────────

function buildOdometerMap(statsData) {
  const map = new Map();  // vehicleId → miles (integer)
  const vehicles = statsData?.data || [];
  for (const v of vehicles) {
    const id = v.id;
    const obdMeters = v.obdOdometerMeters?.value;
    const gpsMeters = v.gpsOdometerMeters?.value;
    const meters = obdMeters ?? gpsMeters;
    if (id && meters != null && meters > 0) {
      map.set(id, Math.round(meters / 1609.344));
    }
  }
  return map;
}

// ── Compute which units need a mileage update ──────────────────────────────

function computeUpdates(odometerMap) {
  const updates = [];
  for (const [unitId, vehicleId] of state.samsara.mapping) {
    const newMiles = odometerMap.get(vehicleId);
    if (newMiles == null) continue;

    const condRow = state.fleet.condition.find(c => c.UnitId === unitId);
    const currentMiles = condRow ? Number(condRow.CurrentMiles) || 0 : 0;

    // Only update if Samsara reports higher mileage and delta exceeds threshold
    const delta = newMiles - currentMiles;
    if (delta < CHANGE_THRESHOLD) continue;

    updates.push({ unitId, newMiles });
  }
  return updates;
}

// ── Batch write condition.csv (one download-mutate-write cycle) ────────────

async function batchUpdateCondition(updates, token) {
  if (!updates.length) return;

  const { text, hash } = await downloadCSV(state.fleet.conditionPath, token);
  if (text === null) throw new Error('condition.csv not found during batch write');
  const rows = parseCSV(text);
  const today = new Date().toISOString().split('T')[0];

  for (const { unitId, newMiles } of updates) {
    const idx = rows.findIndex(r => r.UnitId === unitId);
    if (idx >= 0) {
      rows[idx].CurrentMiles = String(newMiles);
      rows[idx].LastUpdated = today;
    } else {
      rows.push({
        UnitId: unitId,
        CurrentMiles: String(newMiles),
        DotExpiry: '',
        TireNotes: '',
        LastUpdated: today,
      });
    }
  }

  const newText = serializeCSV(CONDITION_HEADERS, rows);

  try {
    await writeCSVWithLock(state.fleet.conditionPath, hash, newText, token);
  } catch (err) {
    if (err.code === 'CSV_CONFLICT') {
      // One retry — re-read and re-apply
      console.warn('Samsara batch write: CSV conflict, retrying...');
      const retry = await downloadCSV(state.fleet.conditionPath, token);
      if (retry.text === null) throw new Error('condition.csv not found during retry');
      const retryRows = parseCSV(retry.text);
      for (const { unitId, newMiles } of updates) {
        const idx = retryRows.findIndex(r => r.UnitId === unitId);
        if (idx >= 0) {
          retryRows[idx].CurrentMiles = String(newMiles);
          retryRows[idx].LastUpdated = today;
        } else {
          retryRows.push({ UnitId: unitId, CurrentMiles: String(newMiles), DotExpiry: '', TireNotes: '', LastUpdated: today });
        }
      }
      await writeCSVWithLock(state.fleet.conditionPath, retry.hash, serializeCSV(CONDITION_HEADERS, retryRows), token);
    } else {
      throw err;
    }
  }

  // Update in-memory condition so next poll and dashboard see fresh values
  for (const { unitId, newMiles } of updates) {
    const row = state.fleet.condition.find(c => c.UnitId === unitId);
    if (row) {
      row.CurrentMiles = String(newMiles);
      row.LastUpdated = today;
    } else {
      state.fleet.condition.push({ UnitId: unitId, CurrentMiles: String(newMiles), DotExpiry: '', TireNotes: '', LastUpdated: today });
    }
  }
}

// ── Single poll tick ───────────────────────────────────────────────────────

async function pollTick() {
  // Skip if tab is hidden
  if (document.visibilityState === 'hidden') return;

  // Skip if no mapping or condition data never loaded
  if (!state.samsara.mapping.size) {
    state.samsara.syncStatus = 'no-mapping';
    return;
  }
  if (!state.samsara._conditionLoaded) return;

  const token = await getValidToken();
  if (!token) return;

  state.samsara.syncStatus = 'syncing';

  try {
    const statsData = await fetchVehicleStats();
    const odometerMap = buildOdometerMap(statsData);
    const updates = computeUpdates(odometerMap);

    if (updates.length) {
      await batchUpdateCondition(updates, token);
      // Re-render dashboard if it's the active view
      if (window.location.hash === '#dashboard' || window.location.hash === '') {
        requestAnimationFrame(() => {
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      }
    }

    state.samsara.lastSynced = Date.now();
    state.samsara.syncStatus = 'ok';
    state.samsara.consecutiveErrors = 0;
    state.samsara.lastError = null;
  } catch (err) {
    console.warn('Samsara poll failed:', err.message);
    state.samsara.consecutiveErrors++;
    state.samsara.lastError = err.message;
    state.samsara.syncStatus = 'error';
  }
}

// ── Poller lifecycle ───────────────────────────────────────────────────────

export function startSamsaraPoller() {
  if (_pollTimer) return;  // already running

  if (!state.samsara.enabled) {
    state.samsara.syncStatus = state.samsara.mapping.size ? 'idle' : 'no-mapping';
    return;
  }

  // Immediate first poll
  pollTick();

  // Recurring poll
  _pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);

  // Re-poll on tab becoming visible if stale
  _visibilityHandler = () => {
    if (document.visibilityState === 'visible' && state.samsara.lastSynced) {
      if (Date.now() - state.samsara.lastSynced > POLL_INTERVAL_MS) {
        setTimeout(pollTick, 2000);  // debounce
      }
    }
  };
  document.addEventListener('visibilitychange', _visibilityHandler);
}

export function stopSamsaraPoller() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }
}

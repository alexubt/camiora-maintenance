/**
 * @module milestones — Category-aware milestone definitions with OneDrive CSV config support.
 *
 * Milestone configs are loaded from milestone-config.csv on OneDrive.
 * Provides configurable due-soon thresholds, time-based due-soon detection,
 * urgency sorting, and CSV write functions.
 *
 * CSV columns: Category, Type, Label, IntervalMiles, IntervalDays
 */

import { state } from '../state.js';
import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock, hashText } from '../graph/csv.js';

/** Default csv operations — wired to real graph/csv.js functions */
const defaultCsvOps = { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock, hashText };

// ── Default milestone definitions per category (fallback if no CSV config) ──

export const DEFAULT_MILESTONES = {
  Truck: [
    { type: 'PM', label: 'PM', intervalMiles: 30000 },
    { type: 'engine-air-filter', label: 'Engine Air Filter', intervalMiles: 100000 },
    { type: 'dpf-cleaning', label: 'DPF Cleaning', intervalMiles: 250000 },
    { type: 'transmission-oil', label: 'Transmission Oil', intervalMiles: 250000 },
    { type: 'differential-oil', label: 'Differential Oil', intervalMiles: 250000 },
    { type: 'air-dryer', label: 'Air Dryer Cartridge', intervalMiles: null, intervalDays: 365 },
    { type: 'belts-tensioners', label: 'Belts & Tensioners', intervalMiles: 250000 },
    { type: 'batteries', label: 'Batteries', intervalMiles: null, intervalDays: 730 },
  ],
  Trailer: [
    { type: 'PM', label: 'PM', intervalMiles: 30000 },
    { type: 'brake-inspection', label: 'Brake Inspection', intervalMiles: 50000 },
    { type: 'wheel-bearings', label: 'Wheel Bearings', intervalMiles: 100000 },
    { type: 'landing-gear', label: 'Landing Gear', intervalMiles: 100000 },
    { type: 'lights-electrical', label: 'Lights & Electrical', intervalMiles: null },
    { type: 'suspension', label: 'Suspension', intervalMiles: 150000 },
  ],
  Reefer: [
    { type: 'PM', label: 'PM', intervalMiles: 30000 },
    { type: 'brake-inspection', label: 'Brake Inspection', intervalMiles: 50000 },
    { type: 'reefer-service', label: 'Reefer Unit Service', intervalMiles: null },
    { type: 'wheel-bearings', label: 'Wheel Bearings', intervalMiles: 100000 },
    { type: 'landing-gear', label: 'Landing Gear', intervalMiles: 100000 },
    { type: 'lights-electrical', label: 'Lights & Electrical', intervalMiles: null },
  ],
};

// ── Standard truck tire positions ───────────────────────────────────────────

export const TIRE_POSITIONS = [
  { key: 'steer-l', label: 'Steer L' },
  { key: 'steer-r', label: 'Steer R' },
  { key: 'drive-outer-l', label: 'Drive Outer L' },
  { key: 'drive-outer-r', label: 'Drive Outer R' },
  { key: 'drive-inner-l', label: 'Drive Inner L' },
  { key: 'drive-inner-r', label: 'Drive Inner R' },
  { key: 'trailer-1-l', label: 'Trailer 1 L' },
  { key: 'trailer-1-r', label: 'Trailer 1 R' },
  { key: 'trailer-2-l', label: 'Trailer 2 L' },
  { key: 'trailer-2-r', label: 'Trailer 2 R' },
];

// ── Get milestones for a category ──────────────────────────────────────────

/**
 * Get milestone definitions for a given unit category.
 * Reads from state.fleet.milestoneConfig (loaded from CSV) first,
 * falls back to DEFAULT_MILESTONES.
 * @param {string} category - e.g. 'Truck', 'Trailer', 'Reefer'
 * @returns {Array<{type: string, label: string, intervalMiles: number|null}>}
 */
export function getMilestonesForCategory(category) {
  const normalized = (category || '').trim();
  if (!normalized) return [];

  // Check CSV config first — filter out _config rows before matching
  const csvRows = (state.fleet.milestoneConfig || []).filter(
    r => (r.Category || '').trim() !== '_config'
  );
  const matching = csvRows.filter(r =>
    (r.Category || '').trim().toLowerCase() === normalized.toLowerCase()
  );

  if (matching.length > 0) {
    return matching.map(r => ({
      type: r.Type || '',
      label: r.Label || r.Type || '',
      intervalMiles: r.IntervalMiles ? Number(r.IntervalMiles) : null,
      intervalDays: r.IntervalDays ? Number(r.IntervalDays) : null,
    }));
  }

  // No CSV rows matched — return empty array (DEFAULT_MILESTONES is for seeding only)
  return [];
}

// ── Backward compat: MILESTONES constant (defaults to Truck) ───────────────

export const MILESTONES = DEFAULT_MILESTONES.Truck;

// ── Config CSV helpers ─────────────────────────────────────────────────────

export const MILESTONE_CONFIG_HEADERS = ['Category', 'Type', 'Label', 'IntervalMiles', 'IntervalDays'];

/**
 * Build the default milestone-config.csv content from DEFAULT_MILESTONES.
 * Used to seed the file on OneDrive if it doesn't exist.
 */
export function buildDefaultConfigCSV() {
  const rows = [];
  for (const [category, milestones] of Object.entries(DEFAULT_MILESTONES)) {
    for (const ms of milestones) {
      rows.push(`${category},${ms.type},${ms.label},${ms.intervalMiles ?? ''},${ms.intervalDays ?? ''}`);
    }
  }
  return MILESTONE_CONFIG_HEADERS.join(',') + '\n' + rows.join('\n');
}

// ── Configurable due-soon thresholds ──────────────────────────────────────

/**
 * Read due-soon threshold configuration from _config rows.
 * @param {Array<Object>} [config] - Rows from state.fleet.milestoneConfig (DI for testability)
 * @returns {{ dueSoonMiles: number, dueSoonDays: number }}
 */
export function getDueSoonThresholds(config = state.fleet.milestoneConfig || []) {
  const configRows = config.filter(r => (r.Category || '').trim() === '_config');

  let dueSoonMiles = 3000;
  let dueSoonDays = 14;

  for (const row of configRows) {
    if ((row.Type || '').trim() === 'due-soon-miles') {
      const val = Number(row.IntervalMiles);
      if (!isNaN(val) && val > 0) dueSoonMiles = val;
    }
    if ((row.Type || '').trim() === 'due-soon-days') {
      const val = Number(row.IntervalDays);
      if (!isNaN(val) && val > 0) dueSoonDays = val;
    }
  }

  return { dueSoonMiles, dueSoonDays };
}

// ── Due-soon detection ─────────────────────────────────────────────────────

/**
 * Determine if a milestone status is "due soon" (not overdue, but approaching).
 * @param {{ status: string, nextDueMiles: number|null, nextDueDate: string|null }} milestoneStatus
 * @param {number} currentMiles
 * @param {number} dueSoonMiles - Threshold in miles
 * @param {number} dueSoonDays - Threshold in days
 * @param {string} [today] - YYYY-MM-DD date string (defaults to today, injectable for tests)
 * @returns {boolean}
 */
export function isDueSoon(milestoneStatus, currentMiles, dueSoonMiles, dueSoonDays, today = new Date().toISOString().split('T')[0]) {
  const { status, nextDueMiles, nextDueDate } = milestoneStatus;

  // Overdue is not due-soon
  if (status === 'overdue') return false;

  // No due thresholds set — not trackable
  if (nextDueMiles == null && nextDueDate == null) return false;

  // Mileage check
  if (nextDueMiles != null) {
    const remaining = nextDueMiles - currentMiles;
    if (remaining >= 0 && remaining <= dueSoonMiles) return true;
  }

  // Time check
  if (nextDueDate) {
    const dueMs = new Date(nextDueDate + 'T00:00:00').getTime();
    const todayMs = new Date(today + 'T00:00:00').getTime();
    const daysRemaining = (dueMs - todayMs) / (1000 * 60 * 60 * 24);
    if (daysRemaining >= 0 && daysRemaining <= dueSoonDays) return true;
  }

  return false;
}

// ── Urgency scoring ────────────────────────────────────────────────────────

/**
 * Compute a numeric urgency score for sorting milestones.
 * Lower score = higher urgency (sorts first).
 * Order: overdue < due-soon < ok < not-tracked / no-interval
 *
 * @param {{ status: string, nextDueMiles: number|null, nextDueDate: string|null }} milestoneStatus
 * @param {number} currentMiles
 * @param {number} dueSoonMiles
 * @param {number} dueSoonDays
 * @returns {number}
 */
export function urgencyScore(milestoneStatus, currentMiles, dueSoonMiles, dueSoonDays) {
  const { status, nextDueMiles } = milestoneStatus;

  if (status === 'overdue') {
    // More overdue = lower score = sorts first
    // Use negative of miles over; if no mileage info use -1 to still beat other overdue without data
    const milesOver = nextDueMiles != null ? currentMiles - nextDueMiles : 1;
    return -1000000 + (-milesOver);
  }

  if (status === 'due-soon') {
    // Closer to due = lower remaining = lower score
    const remaining = nextDueMiles != null ? nextDueMiles - currentMiles : dueSoonMiles;
    return 0 + remaining;
  }

  if (status === 'ok') {
    // Further from due = higher score, all ok items > all due-soon items
    const remaining = nextDueMiles != null ? nextDueMiles - currentMiles : 0;
    return 1000000 + remaining;
  }

  // not-tracked, no-interval — sort last
  return 9000000;
}

// ── CSV write functions ────────────────────────────────────────────────────

/**
 * Save updated milestone config rows to OneDrive CSV.
 * Preserves _config rows from existing CSV, replaces all non-_config rows.
 * Updates state after successful write.
 *
 * @param {Array<Object>} updatedRows - Non-_config rows to write (Category, Type, Label, IntervalMiles, IntervalDays)
 * @param {string} token - Bearer access token
 * @param {Object} [csvOps] - Dependency injection for testing
 */
export async function saveMilestoneConfig(updatedRows, token, csvOps = defaultCsvOps) {
  const path = state.fleet.milestoneConfigPath;

  // Download fresh copy
  const { text, hash } = await csvOps.downloadCSV(path, token);
  const existingRows = csvOps.parseCSV(text);

  // Preserve _config rows from existing CSV
  const configRows = existingRows.filter(r => (r.Category || '').trim() === '_config');

  // Merge: _config rows first, then new non-_config rows
  const mergedRows = [...configRows, ...updatedRows];

  const newCSVText = csvOps.serializeCSV(MILESTONE_CONFIG_HEADERS, mergedRows);
  await csvOps.writeCSVWithLock(path, hash, newCSVText, token);

  // Update state
  const newHash = await csvOps.hashText(newCSVText);
  state.fleet.milestoneConfig = mergedRows;
  state.fleet.milestoneConfigHash = newHash;
}

/**
 * Save due-soon threshold values to OneDrive CSV as _config rows.
 * Replaces existing due-soon-miles and due-soon-days _config rows.
 * Preserves all other rows.
 *
 * @param {number} miles - New dueSoonMiles threshold
 * @param {number} days - New dueSoonDays threshold
 * @param {string} token - Bearer access token
 * @param {Object} [csvOps] - Dependency injection for testing
 */
export async function saveDueSoonThresholds(miles, days, token, csvOps = defaultCsvOps) {
  const path = state.fleet.milestoneConfigPath;

  // Download fresh copy
  const { text, hash } = await csvOps.downloadCSV(path, token);
  const existingRows = csvOps.parseCSV(text);

  // Remove old threshold _config rows
  const nonThresholdRows = existingRows.filter(r => {
    const isConfig = (r.Category || '').trim() === '_config';
    const isThreshold = ['due-soon-miles', 'due-soon-days'].includes((r.Type || '').trim());
    return !(isConfig && isThreshold);
  });

  // Add new threshold rows
  const newThresholdRows = [
    { Category: '_config', Type: 'due-soon-miles', Label: '', IntervalMiles: String(miles), IntervalDays: '' },
    { Category: '_config', Type: 'due-soon-days', Label: '', IntervalMiles: '', IntervalDays: String(days) },
  ];

  const mergedRows = [...newThresholdRows, ...nonThresholdRows];
  const newCSVText = csvOps.serializeCSV(MILESTONE_CONFIG_HEADERS, mergedRows);
  await csvOps.writeCSVWithLock(path, hash, newCSVText, token);

  // Update state
  const newHash = await csvOps.hashText(newCSVText);
  state.fleet.milestoneConfig = mergedRows;
  state.fleet.milestoneConfigHash = newHash;
}

// ── Status calculation ─────────────────────────────────────────────────────

/**
 * Get the status of a milestone given maintenance records and current mileage.
 * Supports mileage-based intervals (intervalMiles) and time-based intervals (intervalDays).
 * @param {{type: string, intervalMiles: number|null, intervalDays: number|null}} milestone
 * @param {Array<{Type: string, LastDoneMiles: string, LastDoneDate: string}>} maintenanceRecords
 * @param {number} currentMiles
 * @returns {{lastDoneMiles: number|null, lastDoneDate: string|null, nextDueMiles: number|null, nextDueDate: string|null, overdue: boolean, status: string, record: object|undefined}}
 */
export function getMilestoneStatus(milestone, maintenanceRecords, currentMiles) {
  const record = maintenanceRecords.find(r => r.Type === milestone.type);

  if (!record) {
    return { lastDoneMiles: null, lastDoneDate: null, nextDueMiles: null, nextDueDate: null, overdue: false, status: 'not-tracked', record: undefined };
  }

  const lastDoneMiles = Number(record.LastDoneMiles) || null;
  const lastDoneDate = record.LastDoneDate || null;
  let nextDueMiles = null;
  let nextDueDate = null;
  let overdue = false;

  // Mileage-based check
  if (milestone.intervalMiles != null && lastDoneMiles != null) {
    nextDueMiles = lastDoneMiles + milestone.intervalMiles;
    if (currentMiles >= nextDueMiles) overdue = true;
  }

  // Time-based check
  if (milestone.intervalDays != null && lastDoneDate) {
    const d = new Date(lastDoneDate + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() + milestone.intervalDays);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      nextDueDate = `${yyyy}-${mm}-${dd}`;
      const today = new Date().toISOString().split('T')[0];
      if (today >= nextDueDate) overdue = true;
    }
  }

  // No interval configured at all
  if (milestone.intervalMiles == null && milestone.intervalDays == null) {
    return { lastDoneMiles, lastDoneDate, nextDueMiles: null, nextDueDate: null, overdue: false, status: 'no-interval', record };
  }

  return {
    lastDoneMiles,
    lastDoneDate,
    nextDueMiles,
    nextDueDate,
    overdue,
    status: overdue ? 'overdue' : 'ok',
    record,
  };
}

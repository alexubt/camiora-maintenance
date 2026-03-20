/**
 * @module milestones — Category-aware milestone definitions with OneDrive CSV config support.
 *
 * Milestone configs are loaded from milestone-config.csv on OneDrive.
 * If unavailable, falls back to hardcoded defaults per category.
 *
 * CSV columns: Category, Type, Label, IntervalMiles
 */

import { state } from '../state.js';

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

  // Check CSV config first
  const csvRows = state.fleet.milestoneConfig || [];
  const matching = csvRows.filter(r =>
    (r.Category || '').trim().toLowerCase() === normalized.toLowerCase()
  );

  if (matching.length > 0) {
    return matching.map(r => ({
      type: r.Type || '',
      label: r.Label || r.Type || '',
      intervalMiles: r.IntervalMiles ? Number(r.IntervalMiles) : null,
    }));
  }

  // Fallback to defaults — try exact match, then pluralized
  if (DEFAULT_MILESTONES[normalized]) return DEFAULT_MILESTONES[normalized];

  // Try singular form (e.g. 'Trucks' → 'Truck')
  const singular = normalized.replace(/s$/i, '');
  if (DEFAULT_MILESTONES[singular]) return DEFAULT_MILESTONES[singular];

  // Unknown category — return generic PM only
  return [{ type: 'PM', label: 'PM', intervalMiles: 30000 }];
}

// ── Backward compat: MILESTONES constant (defaults to Truck) ───────────────

export const MILESTONES = DEFAULT_MILESTONES.Truck;

// ── Config CSV helpers ─────────────────────────────────────────────────────

export const MILESTONE_CONFIG_HEADERS = ['Category', 'Type', 'Label', 'IntervalMiles'];

/**
 * Build the default milestone-config.csv content from DEFAULT_MILESTONES.
 * Used to seed the file on OneDrive if it doesn't exist.
 */
export function buildDefaultConfigCSV() {
  const rows = [];
  for (const [category, milestones] of Object.entries(DEFAULT_MILESTONES)) {
    for (const ms of milestones) {
      rows.push(`${category},${ms.type},${ms.label},${ms.intervalMiles ?? ''}`);
    }
  }
  return MILESTONE_CONFIG_HEADERS.join(',') + '\n' + rows.join('\n');
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

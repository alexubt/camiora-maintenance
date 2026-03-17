/** @module milestones — Milestone definitions, tire positions, and pure calculation helpers */

// Milestone definitions — each has a type key and interval in miles
export const MILESTONES = [
  { type: 'PM', intervalMiles: 30000, label: 'PM' },
  { type: 'engine-air-filter', intervalMiles: 100000, label: 'Engine Air Filter' },
  { type: 'dpf-cleaning', intervalMiles: 250000, label: 'DPF Cleaning' },
  { type: 'transmission-oil', intervalMiles: 250000, label: 'Transmission Oil' },
  { type: 'differential-oil', intervalMiles: 250000, label: 'Differential Oil' },
  { type: 'air-dryer', intervalMiles: null, label: 'Air Dryer' },  // interval not set yet
  { type: 'belts-tensioners', intervalMiles: 250000, label: 'Belts and Tensioners' },
];

// Standard truck tire positions
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

/**
 * Get the status of a milestone given maintenance records and current mileage.
 * @param {{type: string, intervalMiles: number|null}} milestone
 * @param {Array<{Type: string, LastDoneMiles: string, MaintId: string}>} maintenanceRecords
 * @param {number} currentMiles
 * @returns {{lastDoneMiles: number|null, nextDueMiles: number|null, overdue: boolean, status: string, record: object|undefined}}
 */
export function getMilestoneStatus(milestone, maintenanceRecords, currentMiles) {
  const record = maintenanceRecords.find(r => r.Type === milestone.type);

  if (!record) {
    return { lastDoneMiles: null, nextDueMiles: null, overdue: false, status: 'not-tracked', record: undefined };
  }

  if (milestone.intervalMiles === null) {
    const lastDoneMiles = Number(record.LastDoneMiles) || null;
    return { lastDoneMiles, nextDueMiles: null, overdue: false, status: 'no-interval', record };
  }

  const lastDoneMiles = Number(record.LastDoneMiles);
  const nextDueMiles = lastDoneMiles + milestone.intervalMiles;
  const overdue = currentMiles >= nextDueMiles;

  return {
    lastDoneMiles,
    nextDueMiles,
    overdue,
    status: overdue ? 'overdue' : 'ok',
    record,
  };
}

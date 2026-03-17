/** @module schedule — Pure maintenance schedule calculation functions */

/**
 * Compute the due date by adding IntervalDays to LastDoneDate.
 * @param {object} record - { LastDoneDate: string, IntervalDays: string }
 * @returns {string|null} YYYY-MM-DD string or null if data is missing
 */
export function getDueDate(record) {
  const { LastDoneDate, IntervalDays } = record;
  if (!LastDoneDate || !IntervalDays) return null;

  const days = Number(IntervalDays);
  if (!Number.isFinite(days) || days <= 0) return null;

  // Use T00:00:00 to avoid timezone offset issues (parsed as local, not UTC)
  const d = new Date(LastDoneDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;

  d.setDate(d.getDate() + days);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Compute the due mileage by adding IntervalMiles to LastDoneMiles.
 * @param {object} record - { LastDoneMiles: string, IntervalMiles: string }
 * @returns {number|null} due mileage or null if data is missing
 */
export function getDueMiles(record) {
  const { LastDoneMiles, IntervalMiles } = record;
  if (!LastDoneMiles || !IntervalMiles) return null;

  const last = Number(LastDoneMiles);
  const interval = Number(IntervalMiles);
  if (!Number.isFinite(last) || !Number.isFinite(interval)) return null;

  return last + interval;
}

/**
 * Determine if a maintenance record is overdue by date or mileage.
 * Returns true if today > dueDate OR currentMiles >= dueMiles.
 * Returns false if no interval/last-done data is configured.
 * @param {object} record - maintenance record with interval and last-done fields
 * @param {string} todayStr - today's date as YYYY-MM-DD
 * @param {number|null|undefined} currentMiles - current odometer reading
 * @returns {boolean}
 */
export function isOverdue(record, todayStr, currentMiles) {
  const dueDate = getDueDate(record);
  const dueMiles = getDueMiles(record);

  // No schedule configured at all
  if (dueDate === null && dueMiles === null) return false;

  // Time-based check: overdue if today is strictly after the due date
  if (dueDate !== null && todayStr > dueDate) return true;

  // Mileage-based check: overdue if current miles >= due miles
  if (dueMiles !== null && currentMiles != null && currentMiles >= dueMiles) return true;

  return false;
}

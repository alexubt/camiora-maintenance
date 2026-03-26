/**
 * Batch milestone reset — updates multiple maintenance records in a single CSV write.
 *
 * Uses dependency injection (csvOps parameter) for testability — matches pattern
 * used in record.js and sync.js.
 */

import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock } from '../graph/csv.js';

const MAINTENANCE_HEADERS = [
  'MaintId', 'UnitId', 'Type', 'IntervalDays', 'IntervalMiles',
  'LastDoneDate', 'LastDoneMiles', 'Notes',
];

const defaultCsvOps = { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock };

/**
 * Reset multiple milestone types for a unit in a single CSV write.
 *
 * @param {string[]} milestoneTypes  - e.g. ['PM', 'dpf-cleaning', 'transmission-oil']
 * @param {string}   unitId          - e.g. '1108'
 * @param {string}   dateStr         - ISO date string, e.g. '2026-03-26'
 * @param {number|string} miles      - current odometer reading (may be empty string)
 * @param {string}   token           - OAuth access token
 * @param {string}   maintenancePath - remote path to maintenance.csv
 * @param {object}   csvOps          - injectable CSV operations (for testing)
 */
export async function batchMarkDone(
  milestoneTypes,
  unitId,
  dateStr,
  miles,
  token,
  maintenancePath,
  csvOps = defaultCsvOps
) {
  // No-op for empty list — avoids unnecessary CSV download/write
  if (!milestoneTypes || milestoneTypes.length === 0) return;

  // Single download
  const { text, hash } = await csvOps.downloadCSV(maintenancePath, token);
  const rows = csvOps.parseCSV(text);

  const milesStr = miles != null && miles !== '' ? String(miles) : '';

  for (const type of milestoneTypes) {
    const idx = rows.findIndex(r => r.UnitId === unitId && r.Type === type);

    if (idx >= 0) {
      // Update existing row
      rows[idx].LastDoneDate = dateStr;
      rows[idx].LastDoneMiles = milesStr;
    } else {
      // Create new row with generated MaintId
      const maintId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      rows.push({
        MaintId: maintId,
        UnitId: unitId,
        Type: type,
        IntervalDays: '',
        IntervalMiles: '',
        LastDoneDate: dateStr,
        LastDoneMiles: milesStr,
        Notes: '',
      });
    }
  }

  // Single write
  const newText = csvOps.serializeCSV(MAINTENANCE_HEADERS, rows);
  await csvOps.writeCSVWithLock(maintenancePath, hash, newText, token);
}

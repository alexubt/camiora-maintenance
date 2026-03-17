/**
 * Unit CSV record append with optimistic locking.
 * Mirrors invoice/record.js pattern for consistency.
 */

import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock } from '../graph/csv.js';

/** Column order for units.csv */
export const UNIT_HEADERS = ['UnitId', 'Type', 'VIN', 'PlateNr', 'Make', 'Model', 'Year', 'DotExpiry'];

/** Default csv operations — wired to real graph/csv.js functions */
const defaultCsvOps = { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock };

/**
 * Append a single unit row to the remote units.csv.
 * Handles CSV_CONFLICT with one auto-retry.
 *
 * @param {Object} row - Object with keys matching UNIT_HEADERS
 * @param {string} token - Bearer access token
 * @param {string} unitsPath - Remote path, e.g. 'Fleet Maintenance/data/units.csv'
 * @param {Object} [csvOps] - Dependency injection for testing
 * @returns {Promise<Object>} driveItem response from Graph API
 */
export async function appendUnit(row, token, unitsPath, csvOps = defaultCsvOps) {
  // Sanitize: strip commas to prevent CSV breakage
  row.UnitId = (row.UnitId || '').replace(/,/g, '');
  row.Type = (row.Type || '').replace(/,/g, '');

  try {
    return await _doAppend(row, token, unitsPath, csvOps);
  } catch (err) {
    if (err.code === 'CSV_CONFLICT') {
      return await _doAppend(row, token, unitsPath, csvOps);
    }
    throw err;
  }
}

/**
 * Inner append logic: download -> parse -> push row -> serialize -> write.
 */
async function _doAppend(row, token, unitsPath, csvOps) {
  const { text, hash } = await csvOps.downloadCSV(unitsPath, token);
  const rows = csvOps.parseCSV(text);
  rows.push(row);
  const newText = csvOps.serializeCSV(UNIT_HEADERS, rows);
  return await csvOps.writeCSVWithLock(unitsPath, hash, newText, token);
}

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
  // Sanitize: strip commas from all fields to prevent CSV breakage
  for (const key of Object.keys(row)) {
    row[key] = String(row[key] || '').replace(/,/g, '');
  }

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

/**
 * Update a unit row in units.csv. Row-update pattern (like saveConditionUpdate).
 * @param {string} unitId - The UnitId to update
 * @param {Object} updates - Fields to update (VIN, PlateNr, Make, Model, Year, DotExpiry)
 * @param {string} token
 * @param {string} unitsPath
 * @param {Object} [csvOps]
 */
export async function updateUnit(unitId, updates, token, unitsPath, csvOps = defaultCsvOps) {
  const { text, hash } = await csvOps.downloadCSV(unitsPath, token);
  const rows = csvOps.parseCSV(text);
  const idx = rows.findIndex(r => r.UnitId === unitId);
  if (idx < 0) throw new Error(`Unit "${unitId}" not found`);

  // Merge updates, sanitize commas
  for (const key of Object.keys(updates)) {
    if (UNIT_HEADERS.includes(key) && key !== 'UnitId') {
      rows[idx][key] = String(updates[key] || '').replace(/,/g, '');
    }
  }

  const newText = csvOps.serializeCSV(UNIT_HEADERS, rows);
  return await csvOps.writeCSVWithLock(unitsPath, hash, newText, token);
}

/**
 * Delete a unit from units.csv and clean up related rows in maintenance.csv and condition.csv.
 * @param {string} unitId
 * @param {string} token
 * @param {{unitsPath: string, maintenancePath: string, conditionPath: string}} paths
 * @param {Object} [csvOps]
 */
export async function deleteUnit(unitId, token, paths, csvOps = defaultCsvOps) {
  const MAINTENANCE_HEADERS = ['MaintId', 'UnitId', 'Type', 'IntervalDays', 'IntervalMiles', 'LastDoneDate', 'LastDoneMiles', 'Notes'];
  const CONDITION_HEADERS = ['UnitId', 'CurrentMiles', 'DotExpiry', 'TireNotes', 'LastUpdated'];

  // 1. Remove from units.csv
  const { text: uText, hash: uHash } = await csvOps.downloadCSV(paths.unitsPath, token);
  const uRows = csvOps.parseCSV(uText);
  const filtered = uRows.filter(r => r.UnitId !== unitId);
  if (filtered.length === uRows.length) throw new Error(`Unit "${unitId}" not found`);
  const uNewText = csvOps.serializeCSV(UNIT_HEADERS, filtered);
  await csvOps.writeCSVWithLock(paths.unitsPath, uHash, uNewText, token);

  // 2. Remove from maintenance.csv (non-fatal)
  try {
    const { text: mText, hash: mHash } = await csvOps.downloadCSV(paths.maintenancePath, token);
    const mRows = csvOps.parseCSV(mText);
    const mFiltered = mRows.filter(r => r.UnitId !== unitId);
    if (mFiltered.length < mRows.length) {
      const mNewText = csvOps.serializeCSV(MAINTENANCE_HEADERS, mFiltered);
      await csvOps.writeCSVWithLock(paths.maintenancePath, mHash, mNewText, token);
    }
  } catch (e) { console.warn('Maintenance cleanup failed (non-fatal):', e); }

  // 3. Remove from condition.csv (non-fatal)
  try {
    const { text: cText, hash: cHash } = await csvOps.downloadCSV(paths.conditionPath, token);
    const cRows = csvOps.parseCSV(cText);
    const cFiltered = cRows.filter(r => r.UnitId !== unitId);
    if (cFiltered.length < cRows.length) {
      const cNewText = csvOps.serializeCSV(CONDITION_HEADERS, cFiltered);
      await csvOps.writeCSVWithLock(paths.conditionPath, cHash, cNewText, token);
    }
  } catch (e) { console.warn('Condition cleanup failed (non-fatal):', e); }
}

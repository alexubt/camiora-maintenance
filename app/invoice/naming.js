/**
 * Pure functions for invoice filename and folder path construction.
 * No DOM dependencies — fully testable with node:test.
 */

import { CONFIG } from '../graph/auth.js';

/**
 * Build base filename: UNIT_DATE_TYPE format.
 * @param {string} unitId - e.g. 'TR-042'
 * @param {string} svc - service type slug, e.g. 'oil-change'
 * @param {string} date - ISO date string, e.g. '2026-03-16'
 * @returns {string|null} e.g. 'TR-042_2026-03-16_oil-change', or null if any arg missing
 */
export function getBaseName(unitId, svc, date) {
  if (!unitId || !svc || !date) return null;
  return `${unitId}_${date}_${svc}`;
}

/**
 * Build OneDrive folder path for a unit's invoices.
 * @param {string} unitId - e.g. 'TR-042'
 * @param {string} [basePath] - override for testability, defaults to CONFIG.ONEDRIVE_BASE
 * @returns {string} e.g. 'Fleet Maintenance/TR-042/Invoices'
 */
export function buildFolderPath(unitId, basePath = CONFIG.ONEDRIVE_BASE) {
  return `${basePath}/${unitId}/Invoices`;
}

/**
 * Resolve service label from select value and optional custom text.
 * @param {string} selectValue - value from the service type dropdown
 * @param {string} otherText - custom text when selectValue is 'other'
 * @returns {string} slug for the service type
 */
export function getServiceLabel(selectValue, otherText) {
  if (selectValue === 'other') {
    const trimmed = (otherText || '').trim();
    if (!trimmed) return 'other';
    return trimmed.toLowerCase().replace(/\s+/g, '-');
  }
  return selectValue;
}

/**
 * Pure functions for invoice filename and folder path construction.
 * No DOM dependencies — fully testable with node:test.
 */

import { CONFIG } from '../graph/auth.js';

/**
 * Sanitize a string for use in a filename — strip/replace unsafe characters.
 * @param {string} str
 * @returns {string}
 */
function sanitizeForFilename(str) {
  return (str || '').trim()
    .replace(/[\/\\:*?"<>|,&]/g, '')  // strip filesystem-unsafe chars + commas + ampersand
    .replace(/\s+/g, '-')            // spaces to hyphens
    .substring(0, 40);               // cap length
}

/**
 * Build base filename: UNIT_DATE_TYPE_VENDOR_INVNR format.
 * @param {string} unitId - e.g. 'TR-042'
 * @param {string} svc - service type slug, e.g. 'oil-change'
 * @param {string} date - ISO date string, e.g. '2026-03-16'
 * @param {Object} [opts]
 * @param {string} [opts.vendor] - vendor name from extraction
 * @param {string} [opts.invoiceNumber] - invoice number from extraction
 * @returns {string|null} e.g. 'TR-042_2026-03-16_oil-change_KY-Truck-Repair_INV-2086', or null if any required arg missing
 */
export function getBaseName(unitId, svc, date, opts = {}) {
  if (!unitId || !svc || !date) return null;
  let name = `${unitId}_${date}_${svc}`;
  const vendor = sanitizeForFilename(opts.vendor);
  const invNr = sanitizeForFilename(opts.invoiceNumber);
  if (vendor) name += `_${vendor}`;
  if (invNr) name += `_${invNr}`;
  return name;
}

/**
 * Resolve the unit category folder from the unit's Type field.
 * Normalizes common values to plural folder names.
 * @param {string} type - e.g. 'Truck', 'Trailer', 'Reefer'
 * @returns {string} folder name (e.g. 'Trucks', 'Trailers', 'Reefers')
 */
export function getUnitCategory(type) {
  const t = (type || '').trim().toLowerCase();
  if (t === 'truck' || t === 'trucks') return 'Trucks';
  if (t === 'trailer' || t === 'trailers') return 'Trailers';
  if (t === 'reefer' || t === 'reefers') return 'Reefers';
  return type ? type.trim() : 'Other';
}

/**
 * Build OneDrive folder path for a unit's documents.
 * Structure: Fleet Maintenance/{Category}/{UnitId}/{Year}/{DocType}
 * @param {string} unitId - e.g. 'TR-042'
 * @param {Object} [opts]
 * @param {string} [opts.type] - unit type from CSV (e.g. 'Truck'), used for category folder
 * @param {string} [opts.date] - ISO date string for year extraction, defaults to current year
 * @param {string} [opts.docType] - document type folder name, defaults to 'Invoices'
 * @param {string} [opts.basePath] - override for testability, defaults to CONFIG.ONEDRIVE_BASE
 * @returns {string} e.g. 'Fleet Maintenance/Trucks/TR-042/2026/Invoices'
 */
export function buildFolderPath(unitId, opts = {}) {
  const basePath = opts.basePath || CONFIG.ONEDRIVE_BASE;
  const category = getUnitCategory(opts.type);
  const year = opts.date ? opts.date.slice(0, 4) : new Date().getFullYear().toString();
  const docType = opts.docType || 'Invoices';
  return `${basePath}/${category}/${unitId}/${year}/${docType}`;
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

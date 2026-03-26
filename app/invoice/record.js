/**
 * Invoice CSV record append with optimistic locking.
 * Uses dependency injection for csv operations (testable without fetch).
 */

import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock } from '../graph/csv.js';

/** Column order for invoices.csv */
export const INVOICE_HEADERS = ['InvoiceId', 'UnitId', 'Date', 'Type', 'Cost', 'Vendor', 'InvoiceNumber', 'Summary', 'PdfPath'];

/** Default csv operations — wired to real graph/csv.js functions */
const defaultCsvOps = { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock };

/**
 * Append a single invoice row to the remote invoices.csv.
 * Handles first-write (creates header + row) and CSV_CONFLICT (one auto-retry).
 *
 * @param {Object} row - Object with keys matching INVOICE_HEADERS
 * @param {string} token - Bearer access token
 * @param {string} invoicesPath - Remote path, e.g. 'Fleet Maintenance/data/invoices.csv'
 * @param {Object} [csvOps] - Dependency injection for testing
 * @returns {Promise<Object>} driveItem response from Graph API
 */
export async function appendInvoiceRecord(row, token, invoicesPath, csvOps = defaultCsvOps) {
  // Sanitize fields: strip commas to prevent CSV breakage
  row.Cost = (row.Cost || '').replace(/,/g, '');
  row.Vendor = (row.Vendor || '').replace(/,/g, '');
  row.InvoiceNumber = (row.InvoiceNumber || '').replace(/,/g, '');
  row.Summary = (row.Summary || '').replace(/,/g, '');

  try {
    return await _doAppend(row, token, invoicesPath, csvOps);
  } catch (err) {
    if (err.code === 'CSV_CONFLICT') {
      // One auto-retry: re-download, re-append, re-write
      return await _doAppend(row, token, invoicesPath, csvOps);
    }
    throw err;
  }
}

/**
 * Inner append logic: download -> parse -> push row -> serialize -> write.
 */
async function _doAppend(row, token, invoicesPath, csvOps) {
  const { text, hash } = await csvOps.downloadCSV(invoicesPath, token);
  const rows = csvOps.parseCSV(text);
  rows.push(row);
  const newText = csvOps.serializeCSV(INVOICE_HEADERS, rows);
  return await csvOps.writeCSVWithLock(invoicesPath, hash, newText, token);
}

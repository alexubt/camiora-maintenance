/**
 * Tests for batchMarkDone — batch milestone reset in maintenance.csv.
 * Uses node:test with dependency injection for csvOps.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { batchMarkDone } from './batch-milestone.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeRow(unitId, type, lastDoneDate = '', lastDoneMiles = '') {
  return { MaintId: 'M1', UnitId: unitId, Type: type, IntervalDays: '', IntervalMiles: '', LastDoneDate: lastDoneDate, LastDoneMiles: lastDoneMiles, Notes: '' };
}

function makeCsvOps(rows = [], opts = {}) {
  let downloadCount = 0;
  let writeCount = 0;
  let lastWriteArgs = null;

  const csvOps = {
    downloadCSV: async () => {
      downloadCount++;
      return { text: 'csv-text', hash: 'abc123' };
    },
    parseCSV: () => rows.map(r => ({ ...r })), // copy rows
    serializeCSV: (headers, r) => JSON.stringify(r),
    writeCSVWithLock: async (...args) => {
      writeCount++;
      lastWriteArgs = args;
    },
    // Expose counters for assertions
    get downloadCount() { return downloadCount; },
    get writeCount() { return writeCount; },
    get lastWriteArgs() { return lastWriteArgs; },
  };

  return csvOps;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('batchMarkDone', () => {

  it('Test 1: downloads CSV once and writes CSV once when given 3 milestone types', async () => {
    const existingRows = [
      makeRow('1108', 'PM'),
      makeRow('1108', 'dpf-cleaning'),
      makeRow('1108', 'transmission-oil'),
    ];
    const csvOps = makeCsvOps(existingRows);

    await batchMarkDone(
      ['PM', 'dpf-cleaning', 'transmission-oil'],
      '1108',
      '2026-03-26',
      450000,
      'token',
      'Fleet/maintenance.csv',
      csvOps
    );

    assert.equal(csvOps.downloadCount, 1, 'should download CSV exactly once');
    assert.equal(csvOps.writeCount, 1, 'should write CSV exactly once');
  });

  it('Test 2: updates LastDoneDate and LastDoneMiles on existing rows matching UnitId + Type', async () => {
    const existingRows = [
      makeRow('1108', 'PM', '2025-01-01', '400000'),
      makeRow('1108', 'engine-air-filter', '2025-01-01', '380000'),
    ];

    let capturedRows = null;
    const csvOps = {
      downloadCSV: async () => ({ text: 'csv', hash: 'h1' }),
      parseCSV: () => existingRows.map(r => ({ ...r })),
      serializeCSV: (headers, rows) => { capturedRows = rows; return 'csv'; },
      writeCSVWithLock: async () => {},
    };

    await batchMarkDone(
      ['PM', 'engine-air-filter'],
      '1108',
      '2026-03-26',
      450000,
      'token',
      'Fleet/maintenance.csv',
      csvOps
    );

    const pmRow = capturedRows.find(r => r.UnitId === '1108' && r.Type === 'PM');
    const filterRow = capturedRows.find(r => r.UnitId === '1108' && r.Type === 'engine-air-filter');

    assert.ok(pmRow, 'PM row should exist');
    assert.equal(pmRow.LastDoneDate, '2026-03-26', 'PM LastDoneDate should be updated');
    assert.equal(pmRow.LastDoneMiles, '450000', 'PM LastDoneMiles should be updated');

    assert.ok(filterRow, 'engine-air-filter row should exist');
    assert.equal(filterRow.LastDoneDate, '2026-03-26', 'filter LastDoneDate should be updated');
    assert.equal(filterRow.LastDoneMiles, '450000', 'filter LastDoneMiles should be updated');
  });

  it('Test 3: creates new rows for milestone types not found in CSV', async () => {
    const existingRows = [
      makeRow('1108', 'PM'),
    ];

    let capturedRows = null;
    const csvOps = {
      downloadCSV: async () => ({ text: 'csv', hash: 'h1' }),
      parseCSV: () => existingRows.map(r => ({ ...r })),
      serializeCSV: (headers, rows) => { capturedRows = rows; return 'csv'; },
      writeCSVWithLock: async () => {},
    };

    await batchMarkDone(
      ['PM', 'dpf-cleaning'],
      '1108',
      '2026-03-26',
      450000,
      'token',
      'Fleet/maintenance.csv',
      csvOps
    );

    // Should have 2 rows: original PM row + new dpf-cleaning row
    assert.equal(capturedRows.length, 2, 'should have 2 rows after adding dpf-cleaning');

    const newRow = capturedRows.find(r => r.Type === 'dpf-cleaning');
    assert.ok(newRow, 'new dpf-cleaning row should exist');
    assert.equal(newRow.UnitId, '1108', 'new row should have correct UnitId');
    assert.equal(newRow.LastDoneDate, '2026-03-26', 'new row LastDoneDate should be set');
    assert.equal(newRow.LastDoneMiles, '450000', 'new row LastDoneMiles should be set');
    assert.ok(newRow.MaintId, 'new row should have a generated MaintId');
  });

  it('Test 4: does nothing when milestoneTypes is empty', async () => {
    let downloadCalled = false;
    let writeCalled = false;

    const csvOps = {
      downloadCSV: async () => { downloadCalled = true; return { text: 'csv', hash: 'h1' }; },
      parseCSV: () => [],
      serializeCSV: () => 'csv',
      writeCSVWithLock: async () => { writeCalled = true; },
    };

    await batchMarkDone(
      [],
      '1108',
      '2026-03-26',
      450000,
      'token',
      'Fleet/maintenance.csv',
      csvOps
    );

    assert.equal(downloadCalled, false, 'should not download CSV for empty milestoneTypes');
    assert.equal(writeCalled, false, 'should not write CSV for empty milestoneTypes');
  });

  it('Test 5: passes correct hash from the single download to writeCSVWithLock', async () => {
    const existingRows = [makeRow('1108', 'PM')];
    let capturedHash = null;

    const csvOps = {
      downloadCSV: async () => ({ text: 'csv-text', hash: 'specific-hash-xyz' }),
      parseCSV: () => existingRows.map(r => ({ ...r })),
      serializeCSV: () => 'serialized',
      writeCSVWithLock: async (path, hash, text, token) => {
        capturedHash = hash;
      },
    };

    await batchMarkDone(
      ['PM'],
      '1108',
      '2026-03-26',
      450000,
      'token',
      'Fleet/maintenance.csv',
      csvOps
    );

    assert.equal(capturedHash, 'specific-hash-xyz', 'writeCSVWithLock should receive the hash from the single download');
  });

});

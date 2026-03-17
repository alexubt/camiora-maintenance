import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendInvoiceRecord, INVOICE_HEADERS } from './record.js';

describe('INVOICE_HEADERS', () => {
  it('has the correct columns', () => {
    assert.deepStrictEqual(INVOICE_HEADERS, [
      'InvoiceId', 'UnitId', 'Date', 'Type', 'Cost', 'PdfPath',
    ]);
  });
});

describe('appendInvoiceRecord', () => {
  const token = 'fake-token';
  const invoicesPath = 'Fleet Maintenance/data/invoices.csv';

  function makeMockOps(overrides = {}) {
    return {
      downloadCSV: overrides.downloadCSV || (async () => ({ text: null, hash: null })),
      parseCSV: overrides.parseCSV || ((text) => {
        if (!text) return [];
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',');
        return lines.slice(1).map(line => {
          const vals = line.split(',');
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i] : ''; });
          return obj;
        });
      }),
      serializeCSV: overrides.serializeCSV || ((headers, rows) => {
        const hLine = headers.join(',');
        const dLines = rows.map(r => headers.map(h => r[h] !== undefined ? r[h] : '').join(','));
        return [hLine, ...dLines].join('\n');
      }),
      writeCSVWithLock: overrides.writeCSVWithLock || (async () => ({ id: 'item-1' })),
    };
  }

  it('calls downloadCSV, parseCSV, serializeCSV, writeCSVWithLock in order', async () => {
    const calls = [];
    const ops = makeMockOps({
      downloadCSV: async (path, tk) => { calls.push('download'); return { text: null, hash: null }; },
      parseCSV: (text) => { calls.push('parse'); return []; },
      serializeCSV: (h, r) => { calls.push('serialize'); return h.join(',') + '\n' + r.map(row => h.map(k => row[k] || '').join(',')).join('\n'); },
      writeCSVWithLock: async () => { calls.push('write'); return { id: 'x' }; },
    });
    const row = { InvoiceId: 'INV-001', UnitId: 'TR-042', Date: '2026-03-16', Type: 'oil-change', Cost: '150', PdfPath: '/path/to/file.pdf' };
    await appendInvoiceRecord(row, token, invoicesPath, ops);
    assert.deepStrictEqual(calls, ['download', 'parse', 'serialize', 'write']);
  });

  it('first write (null text/hash) produces header + data row', async () => {
    let writtenText = '';
    const ops = makeMockOps({
      writeCSVWithLock: async (path, hash, text) => { writtenText = text; return { id: 'x' }; },
    });
    const row = { InvoiceId: 'INV-001', UnitId: 'TR-042', Date: '2026-03-16', Type: 'oil-change', Cost: '150', PdfPath: '/path.pdf' };
    await appendInvoiceRecord(row, token, invoicesPath, ops);
    const lines = writtenText.split('\n');
    assert.equal(lines[0], 'InvoiceId,UnitId,Date,Type,Cost,PdfPath');
    assert.equal(lines[1], 'INV-001,TR-042,2026-03-16,oil-change,150,/path.pdf');
  });

  it('subsequent write appends without losing existing data', async () => {
    let writtenText = '';
    const existingCSV = 'InvoiceId,UnitId,Date,Type,Cost,PdfPath\nINV-001,TR-042,2026-03-16,oil-change,150,/path1.pdf';
    const ops = makeMockOps({
      downloadCSV: async () => ({ text: existingCSV, hash: 'abc123' }),
      writeCSVWithLock: async (path, hash, text) => { writtenText = text; return { id: 'x' }; },
    });
    const row = { InvoiceId: 'INV-002', UnitId: 'TL-017', Date: '2026-03-17', Type: 'dot-inspection', Cost: '200', PdfPath: '/path2.pdf' };
    await appendInvoiceRecord(row, token, invoicesPath, ops);
    const lines = writtenText.split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[1], 'INV-001,TR-042,2026-03-16,oil-change,150,/path1.pdf');
    assert.equal(lines[2], 'INV-002,TL-017,2026-03-17,dot-inspection,200,/path2.pdf');
  });

  it('retries exactly once on CSV_CONFLICT', async () => {
    let writeAttempts = 0;
    const ops = makeMockOps({
      downloadCSV: async () => ({ text: null, hash: null }),
      writeCSVWithLock: async () => {
        writeAttempts++;
        if (writeAttempts === 1) {
          const err = new Error('conflict');
          err.code = 'CSV_CONFLICT';
          throw err;
        }
        return { id: 'x' };
      },
    });
    const row = { InvoiceId: 'INV-001', UnitId: 'TR-042', Date: '2026-03-16', Type: 'oil-change', Cost: '150', PdfPath: '/p.pdf' };
    await appendInvoiceRecord(row, token, invoicesPath, ops);
    assert.equal(writeAttempts, 2);
  });

  it('propagates error on second CSV_CONFLICT', async () => {
    const ops = makeMockOps({
      downloadCSV: async () => ({ text: null, hash: null }),
      writeCSVWithLock: async () => {
        const err = new Error('conflict');
        err.code = 'CSV_CONFLICT';
        throw err;
      },
    });
    const row = { InvoiceId: 'INV-001', UnitId: 'TR-042', Date: '2026-03-16', Type: 'oil-change', Cost: '150', PdfPath: '/p.pdf' };
    await assert.rejects(
      () => appendInvoiceRecord(row, token, invoicesPath, ops),
      (err) => err.code === 'CSV_CONFLICT'
    );
  });

  it('row with empty Cost serializes as empty string not undefined', async () => {
    let writtenText = '';
    const ops = makeMockOps({
      writeCSVWithLock: async (path, hash, text) => { writtenText = text; return { id: 'x' }; },
    });
    const row = { InvoiceId: 'INV-001', UnitId: 'TR-042', Date: '2026-03-16', Type: 'oil-change', Cost: '', PdfPath: '/p.pdf' };
    await appendInvoiceRecord(row, token, invoicesPath, ops);
    const lines = writtenText.split('\n');
    // Cost column should be empty, not 'undefined'
    assert.ok(!lines[1].includes('undefined'), 'Cost should not be undefined');
    const values = lines[1].split(',');
    assert.equal(values[4], ''); // Cost is index 4
  });

  it('strips commas from Cost field', async () => {
    let writtenText = '';
    const ops = makeMockOps({
      writeCSVWithLock: async (path, hash, text) => { writtenText = text; return { id: 'x' }; },
    });
    const row = { InvoiceId: 'INV-001', UnitId: 'TR-042', Date: '2026-03-16', Type: 'oil-change', Cost: '1,500', PdfPath: '/p.pdf' };
    await appendInvoiceRecord(row, token, invoicesPath, ops);
    const lines = writtenText.split('\n');
    // Cost should be 1500 (commas stripped)
    assert.ok(lines[1].includes('1500'), 'Cost commas should be stripped');
  });
});

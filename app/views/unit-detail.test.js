/**
 * Unit detail view tests — data loading, condition update, escapeHtml, dotStatus.
 * Uses DI pattern (same as record.test.js) for csvOps.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadUnitData, saveConditionUpdate, escapeHtml, dotStatus } from './unit-detail.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeMockOps(csvMap = {}) {
  const writeCalls = [];
  return {
    ops: {
      downloadCSV: async (path) => {
        const entry = csvMap[path];
        if (!entry) return { text: null, hash: null };
        return { text: entry, hash: 'fakehash-' + path };
      },
      parseCSV: (text) => {
        if (!text) return [];
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        return lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim());
          const obj = {};
          headers.forEach((k, i) => { obj[k] = vals[i] || ''; });
          return obj;
        });
      },
      serializeCSV: (headers, rows) => {
        const hdr = headers.join(',');
        const data = rows.map(r => headers.map(h => r[h] || '').join(','));
        return [hdr, ...data].join('\n');
      },
      writeCSVWithLock: async (path, hash, text, token) => {
        writeCalls.push({ path, hash, text, token });
        return { id: 'mock-drive-item' };
      },
    },
    writeCalls,
  };
}

const INVOICES_CSV = `InvoiceId,UnitId,Date,Type,Cost,PdfPath
inv1,TR-042,2025-01-15,oil-change,150,path/to/inv1.pdf
inv2,TR-099,2025-02-20,brakes,300,path/to/inv2.pdf
inv3,TR-042,2025-03-10,pm-service,200,path/to/inv3.pdf`;

const MAINTENANCE_CSV = `MaintId,UnitId,Type,IntervalDays,IntervalMiles,LastDoneDate,LastDoneMiles,Notes
m1,TR-042,oil-change,90,5000,2025-01-15,50000,standard
m2,TR-042,pm-service,180,10000,2025-03-10,52000,full pm
m3,TR-099,brakes,365,,2025-02-20,,check pads`;

const CONDITION_CSV = `UnitId,CurrentMiles,DotExpiry,TireNotes,LastUpdated
TR-042,55000,2025-12-31,front tires worn,2025-06-01
TR-099,30000,2026-06-30,good,2025-05-15`;

// ── loadUnitData tests ────────────────────────────────────────────────────────

describe('loadUnitData', () => {
  it('filters invoices by UnitId', async () => {
    const { ops } = makeMockOps({
      'invoices.csv': INVOICES_CSV,
      'maintenance.csv': MAINTENANCE_CSV,
      'condition.csv': CONDITION_CSV,
    });
    const paths = { invoicesPath: 'invoices.csv', maintenancePath: 'maintenance.csv', conditionPath: 'condition.csv' };
    const data = await loadUnitData('TR-042', 'tok', paths, ops);
    assert.equal(data.invoices.length, 2);
    assert.ok(data.invoices.every(r => r.UnitId === 'TR-042'));
  });

  it('filters maintenance by UnitId', async () => {
    const { ops } = makeMockOps({
      'invoices.csv': INVOICES_CSV,
      'maintenance.csv': MAINTENANCE_CSV,
      'condition.csv': CONDITION_CSV,
    });
    const paths = { invoicesPath: 'invoices.csv', maintenancePath: 'maintenance.csv', conditionPath: 'condition.csv' };
    const data = await loadUnitData('TR-042', 'tok', paths, ops);
    assert.equal(data.maintenance.length, 2);
    assert.ok(data.maintenance.every(r => r.UnitId === 'TR-042'));
  });

  it('finds single condition row by UnitId', async () => {
    const { ops } = makeMockOps({
      'invoices.csv': INVOICES_CSV,
      'maintenance.csv': MAINTENANCE_CSV,
      'condition.csv': CONDITION_CSV,
    });
    const paths = { invoicesPath: 'invoices.csv', maintenancePath: 'maintenance.csv', conditionPath: 'condition.csv' };
    const data = await loadUnitData('TR-042', 'tok', paths, ops);
    assert.equal(data.condition.UnitId, 'TR-042');
    assert.equal(data.condition.CurrentMiles, '55000');
  });

  it('returns null condition on 404', async () => {
    const { ops } = makeMockOps({
      'invoices.csv': INVOICES_CSV,
      'maintenance.csv': MAINTENANCE_CSV,
    });
    const paths = { invoicesPath: 'invoices.csv', maintenancePath: 'maintenance.csv', conditionPath: 'condition.csv' };
    const data = await loadUnitData('TR-042', 'tok', paths, ops);
    assert.equal(data.condition, null);
  });

  it('returns empty maintenance on 404', async () => {
    const { ops } = makeMockOps({
      'invoices.csv': INVOICES_CSV,
      'condition.csv': CONDITION_CSV,
    });
    const paths = { invoicesPath: 'invoices.csv', maintenancePath: 'maintenance.csv', conditionPath: 'condition.csv' };
    const data = await loadUnitData('TR-042', 'tok', paths, ops);
    assert.deepEqual(data.maintenance, []);
  });
});

// ── saveConditionUpdate tests ─────────────────────────────────────────────────

describe('saveConditionUpdate', () => {
  it('updates existing row in-place (not append)', async () => {
    const { ops, writeCalls } = makeMockOps({
      'condition.csv': CONDITION_CSV,
    });
    await saveConditionUpdate('TR-042', { CurrentMiles: '60000', DotExpiry: '2026-06-30', TireNotes: 'new tires' }, 'tok', 'condition.csv', ops);
    assert.equal(writeCalls.length, 1);
    const written = writeCalls[0].text;
    // Should still have 2 data rows (TR-042 updated, TR-099 unchanged)
    const lines = written.split('\n').filter(l => l.trim());
    assert.equal(lines.length, 3); // header + 2 rows
    assert.ok(written.includes('60000'));
    assert.ok(written.includes('new tires'));
  });

  it('creates new row when UnitId not found', async () => {
    const { ops, writeCalls } = makeMockOps({
      'condition.csv': CONDITION_CSV,
    });
    await saveConditionUpdate('TR-NEW', { CurrentMiles: '1000', DotExpiry: '2027-01-01', TireNotes: 'brand new' }, 'tok', 'condition.csv', ops);
    assert.equal(writeCalls.length, 1);
    const written = writeCalls[0].text;
    const lines = written.split('\n').filter(l => l.trim());
    assert.equal(lines.length, 4); // header + 3 rows (original 2 + new)
    assert.ok(written.includes('TR-NEW'));
    assert.ok(written.includes('brand new'));
  });
});

// ── escapeHtml tests ──────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes &, <, >, " characters', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
    assert.equal(escapeHtml('a & <b> "c"'), 'a &amp; &lt;b&gt; &quot;c&quot;');
  });

  it('returns empty string for falsy input', () => {
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

// ── dotStatus tests ───────────────────────────────────────────────────────────

describe('dotStatus', () => {
  it('returns expired when DotExpiry < today', () => {
    assert.equal(dotStatus('2025-01-01', '2025-06-01'), 'expired');
  });

  it('returns warning when DotExpiry within 30 days', () => {
    assert.equal(dotStatus('2025-06-15', '2025-06-01'), 'warning');
  });

  it('returns ok when DotExpiry > 30 days away', () => {
    assert.equal(dotStatus('2026-06-01', '2025-06-01'), 'ok');
  });

  it('returns unknown when DotExpiry is empty or missing', () => {
    assert.equal(dotStatus('', '2025-06-01'), 'unknown');
    assert.equal(dotStatus(null, '2025-06-01'), 'unknown');
  });
});

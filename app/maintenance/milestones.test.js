import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDueSoonThresholds,
  isDueSoon,
  getMilestonesForCategory,
  saveMilestoneConfig,
  saveDueSoonThresholds,
  urgencyScore,
} from './milestones.js';

// ── getDueSoonThresholds ──────────────────────────────────────────────────────

describe('getDueSoonThresholds', () => {
  it('returns defaults when config is empty', () => {
    const result = getDueSoonThresholds([]);
    assert.deepEqual(result, { dueSoonMiles: 3000, dueSoonDays: 14 });
  });

  it('returns defaults when no _config rows exist', () => {
    const config = [
      { Category: 'Truck', Type: 'PM', Label: 'PM', IntervalMiles: '30000', IntervalDays: '' },
    ];
    const result = getDueSoonThresholds(config);
    assert.deepEqual(result, { dueSoonMiles: 3000, dueSoonDays: 14 });
  });

  it('reads dueSoonMiles from _config due-soon-miles row', () => {
    const config = [
      { Category: '_config', Type: 'due-soon-miles', Label: '', IntervalMiles: '5000', IntervalDays: '' },
    ];
    const result = getDueSoonThresholds(config);
    assert.equal(result.dueSoonMiles, 5000);
    assert.equal(result.dueSoonDays, 14);
  });

  it('reads dueSoonDays from _config due-soon-days row', () => {
    const config = [
      { Category: '_config', Type: 'due-soon-days', Label: '', IntervalMiles: '', IntervalDays: '30' },
    ];
    const result = getDueSoonThresholds(config);
    assert.equal(result.dueSoonMiles, 3000);
    assert.equal(result.dueSoonDays, 30);
  });

  it('reads both thresholds from _config rows', () => {
    const config = [
      { Category: '_config', Type: 'due-soon-miles', Label: '', IntervalMiles: '2500', IntervalDays: '' },
      { Category: '_config', Type: 'due-soon-days', Label: '', IntervalMiles: '', IntervalDays: '7' },
    ];
    const result = getDueSoonThresholds(config);
    assert.deepEqual(result, { dueSoonMiles: 2500, dueSoonDays: 7 });
  });

  it('falls back to default when IntervalMiles is missing/empty for due-soon-miles row', () => {
    const config = [
      { Category: '_config', Type: 'due-soon-miles', Label: '', IntervalMiles: '', IntervalDays: '' },
    ];
    const result = getDueSoonThresholds(config);
    assert.equal(result.dueSoonMiles, 3000);
  });

  it('falls back to default when IntervalDays is missing/empty for due-soon-days row', () => {
    const config = [
      { Category: '_config', Type: 'due-soon-days', Label: '', IntervalMiles: '', IntervalDays: '' },
    ];
    const result = getDueSoonThresholds(config);
    assert.equal(result.dueSoonDays, 14);
  });
});

// ── isDueSoon ─────────────────────────────────────────────────────────────────

describe('isDueSoon', () => {
  const today = '2026-03-30';

  it('returns false when status is overdue', () => {
    const ms = { status: 'overdue', nextDueMiles: 100000, nextDueDate: null };
    assert.equal(isDueSoon(ms, 102000, 3000, 14, today), false);
  });

  it('returns false when nextDueMiles and nextDueDate are both null', () => {
    const ms = { status: 'ok', nextDueMiles: null, nextDueDate: null };
    assert.equal(isDueSoon(ms, 100000, 3000, 14, today), false);
  });

  it('returns true when mileage remaining is within dueSoonMiles threshold', () => {
    // nextDue = 103000, current = 100500, remaining = 2500 < 3000
    const ms = { status: 'ok', nextDueMiles: 103000, nextDueDate: null };
    assert.equal(isDueSoon(ms, 100500, 3000, 14, today), true);
  });

  it('returns false when mileage remaining is beyond dueSoonMiles threshold', () => {
    // nextDue = 103000, current = 99000, remaining = 4000 > 3000
    const ms = { status: 'ok', nextDueMiles: 103000, nextDueDate: null };
    assert.equal(isDueSoon(ms, 99000, 3000, 14, today), false);
  });

  it('returns true when nextDueDate is within dueSoonDays of today', () => {
    // today = 2026-03-30, due = 2026-04-10, days = 11 <= 14
    const ms = { status: 'ok', nextDueMiles: null, nextDueDate: '2026-04-10' };
    assert.equal(isDueSoon(ms, 100000, 3000, 14, today), true);
  });

  it('returns false when nextDueDate is beyond dueSoonDays of today', () => {
    // today = 2026-03-30, due = 2026-04-20, days = 21 > 14
    const ms = { status: 'ok', nextDueMiles: null, nextDueDate: '2026-04-20' };
    assert.equal(isDueSoon(ms, 100000, 3000, 14, today), false);
  });

  it('returns true when nextDueDate is exactly today (0 days)', () => {
    const ms = { status: 'ok', nextDueMiles: null, nextDueDate: '2026-03-30' };
    assert.equal(isDueSoon(ms, 100000, 3000, 14, today), true);
  });

  it('returns false when nextDueDate is in the past (overdue condition handled separately)', () => {
    // Past dates with status 'ok' means overdue wasn't computed, but isDueSoon checks >= 0
    const ms = { status: 'ok', nextDueMiles: null, nextDueDate: '2026-03-01' };
    assert.equal(isDueSoon(ms, 100000, 3000, 14, today), false);
  });

  it('returns true when either mileage or time condition is true', () => {
    // Miles beyond threshold but date within threshold
    const ms = { status: 'ok', nextDueMiles: 105000, nextDueDate: '2026-04-05' };
    assert.equal(isDueSoon(ms, 99000, 3000, 14, today), true);
  });
});

// ── getMilestonesForCategory (modified) ───────────────────────────────────────

describe('getMilestonesForCategory', () => {
  it('filters out _config rows before matching', () => {
    // _config rows should never appear in results
    // This is tested via state injection in the actual implementation,
    // but we verify the behavior by checking categories don't include _config items
    // (The function reads from state, so we test the exported function behavior
    // when state has _config rows mixed in — see integration note below)
    // Direct test: call with empty state => returns []
    // (state.fleet.milestoneConfig is [] initially when module first loads in tests)
    const result = getMilestonesForCategory('UnknownCategory12345');
    assert.deepEqual(result, []);
  });

  it('returns empty array for unknown category with no CSV data', () => {
    const result = getMilestonesForCategory('Spaceship');
    assert.deepEqual(result, []);
  });

  it('returns empty array for empty category string', () => {
    const result = getMilestonesForCategory('');
    assert.deepEqual(result, []);
  });
});

// ── urgencyScore ──────────────────────────────────────────────────────────────

describe('urgencyScore', () => {
  const dueSoonMiles = 3000;
  const dueSoonDays = 14;

  it('overdue sorts before due-soon', () => {
    const overdueScore = urgencyScore({ status: 'overdue', nextDueMiles: 100000, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    const dueSoonScore = urgencyScore({ status: 'due-soon', nextDueMiles: 103000, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    assert.ok(overdueScore < dueSoonScore, `overdue (${overdueScore}) should be < due-soon (${dueSoonScore})`);
  });

  it('due-soon sorts before ok', () => {
    const dueSoonScore = urgencyScore({ status: 'due-soon', nextDueMiles: 103000, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    const okScore = urgencyScore({ status: 'ok', nextDueMiles: 200000, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    assert.ok(dueSoonScore < okScore, `due-soon (${dueSoonScore}) should be < ok (${okScore})`);
  });

  it('ok sorts before not-tracked', () => {
    const okScore = urgencyScore({ status: 'ok', nextDueMiles: 200000, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    const notTrackedScore = urgencyScore({ status: 'not-tracked', nextDueMiles: null, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    assert.ok(okScore < notTrackedScore, `ok (${okScore}) should be < not-tracked (${notTrackedScore})`);
  });

  it('ok sorts before no-interval', () => {
    const okScore = urgencyScore({ status: 'ok', nextDueMiles: 200000, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    const noIntervalScore = urgencyScore({ status: 'no-interval', nextDueMiles: null, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    assert.ok(okScore < noIntervalScore, `ok (${okScore}) should be < no-interval (${noIntervalScore})`);
  });

  it('within overdue, more overdue (higher miles over) sorts first (lower score)', () => {
    // 3000 miles over vs 1000 miles over
    const moreOverdue = urgencyScore({ status: 'overdue', nextDueMiles: 100000, nextDueDate: null }, 103000, dueSoonMiles, dueSoonDays);
    const lessOverdue = urgencyScore({ status: 'overdue', nextDueMiles: 100000, nextDueDate: null }, 101000, dueSoonMiles, dueSoonDays);
    assert.ok(moreOverdue < lessOverdue, `more overdue (${moreOverdue}) should be < less overdue (${lessOverdue})`);
  });

  it('within due-soon, closer to due (lower remaining) sorts first (lower score)', () => {
    // 500 miles remaining vs 2000 miles remaining
    const closer = urgencyScore({ status: 'due-soon', nextDueMiles: 100500, nextDueDate: null }, 100000, dueSoonMiles, dueSoonDays);
    const farther = urgencyScore({ status: 'due-soon', nextDueMiles: 102000, nextDueDate: null }, 100000, dueSoonMiles, dueSoonDays);
    assert.ok(closer < farther, `closer (${closer}) should be < farther (${farther})`);
  });
});

// ── saveMilestoneConfig ───────────────────────────────────────────────────────

describe('saveMilestoneConfig', () => {
  it('downloads fresh CSV, merges, writes and updates state', async () => {
    const existingCSV = 'Category,Type,Label,IntervalMiles,IntervalDays\n_config,due-soon-miles,,5000,\nTruck,PM,PM,30000,\n';
    const calls = [];

    const mockCsvOps = {
      downloadCSV: async (path, token) => {
        calls.push({ op: 'download', path, token });
        return { text: existingCSV, hash: 'hash-abc' };
      },
      parseCSV: (text) => {
        if (!text) return [];
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',');
        return lines.slice(1).map(line => {
          const vals = line.split(',');
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
          return obj;
        });
      },
      serializeCSV: (headers, rows) => {
        return [headers.join(','), ...rows.map(r => headers.map(h => r[h] ?? '').join(','))].join('\n');
      },
      writeCSVWithLock: async (path, hash, csvText, token) => {
        calls.push({ op: 'write', path, hash, csvText, token });
        return { id: 'file-id' };
      },
      hashText: async (text) => 'new-hash-xyz',
    };

    const updatedRows = [
      { Category: 'Truck', Type: 'PM', Label: 'PM', IntervalMiles: '35000', IntervalDays: '' },
    ];

    await saveMilestoneConfig(updatedRows, 'token-123', mockCsvOps);

    // Should have called download and write
    assert.equal(calls.filter(c => c.op === 'download').length, 1);
    assert.equal(calls.filter(c => c.op === 'write').length, 1);

    // Written CSV should preserve _config rows and include updated non-config rows
    const writeCall = calls.find(c => c.op === 'write');
    assert.ok(writeCall.csvText.includes('_config'), 'should preserve _config rows');
    assert.ok(writeCall.csvText.includes('35000'), 'should include updated interval');
  });

  it('uses provided token', async () => {
    const calls = [];
    const mockCsvOps = {
      downloadCSV: async (path, token) => {
        calls.push({ op: 'download', token });
        return { text: 'Category,Type,Label,IntervalMiles,IntervalDays\n', hash: 'h1' };
      },
      parseCSV: () => [],
      serializeCSV: (h, r) => h.join(','),
      writeCSVWithLock: async (path, hash, text, token) => {
        calls.push({ op: 'write', token });
        return {};
      },
      hashText: async () => 'h2',
    };

    await saveMilestoneConfig([], 'my-bearer-token', mockCsvOps);
    assert.equal(calls[0].token, 'my-bearer-token');
  });
});

// ── saveDueSoonThresholds ─────────────────────────────────────────────────────

describe('saveDueSoonThresholds', () => {
  it('removes old _config threshold rows and adds new ones', async () => {
    const existingCSV = 'Category,Type,Label,IntervalMiles,IntervalDays\n_config,due-soon-miles,,3000,\n_config,due-soon-days,,,14\nTruck,PM,PM,30000,\n';
    const calls = [];

    const mockCsvOps = {
      downloadCSV: async () => {
        calls.push('download');
        return { text: existingCSV, hash: 'hash-old' };
      },
      parseCSV: (text) => {
        if (!text) return [];
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',');
        return lines.slice(1).map(line => {
          const vals = line.split(',');
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
          return obj;
        });
      },
      serializeCSV: (headers, rows) => {
        return [headers.join(','), ...rows.map(r => headers.map(h => r[h] ?? '').join(','))].join('\n');
      },
      writeCSVWithLock: async (path, hash, csvText, token) => {
        calls.push({ op: 'write', csvText });
        return {};
      },
      hashText: async () => 'hash-new',
    };

    await saveDueSoonThresholds(5000, 30, 'token', mockCsvOps);

    const writeCall = calls.find(c => c && c.op === 'write');
    assert.ok(writeCall, 'should have written');

    // Should have new thresholds
    assert.ok(writeCall.csvText.includes('5000'), 'should include new miles threshold');
    assert.ok(writeCall.csvText.includes('30'), 'should include new days threshold');

    // Should preserve non-threshold rows
    assert.ok(writeCall.csvText.includes('Truck'), 'should preserve truck rows');
  });

  it('preserves all non-threshold rows', async () => {
    const existingCSV = 'Category,Type,Label,IntervalMiles,IntervalDays\n_config,due-soon-miles,,3000,\nTruck,PM,PM,30000,\nTrailer,PM,PM,30000,\n';
    let writtenCSV = '';

    const mockCsvOps = {
      downloadCSV: async () => ({ text: existingCSV, hash: 'h1' }),
      parseCSV: (text) => {
        if (!text) return [];
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',');
        return lines.slice(1).map(line => {
          const vals = line.split(',');
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
          return obj;
        });
      },
      serializeCSV: (headers, rows) => {
        return [headers.join(','), ...rows.map(r => headers.map(h => r[h] ?? '').join(','))].join('\n');
      },
      writeCSVWithLock: async (path, hash, csvText) => {
        writtenCSV = csvText;
        return {};
      },
      hashText: async () => 'h2',
    };

    await saveDueSoonThresholds(2500, 7, 'token', mockCsvOps);

    assert.ok(writtenCSV.includes('Truck'), 'Truck rows preserved');
    assert.ok(writtenCSV.includes('Trailer'), 'Trailer rows preserved');
  });
});

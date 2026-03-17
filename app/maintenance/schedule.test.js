import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDueDate, getDueMiles, isOverdue } from './schedule.js';

describe('getDueDate', () => {
  it('adds IntervalDays to LastDoneDate', () => {
    assert.equal(
      getDueDate({ LastDoneDate: '2025-09-01', IntervalDays: '365' }),
      '2026-09-01',
    );
  });

  it('handles month rollover correctly', () => {
    assert.equal(
      getDueDate({ LastDoneDate: '2026-01-31', IntervalDays: '30' }),
      '2026-03-02',
    );
  });

  it('returns null when LastDoneDate is empty', () => {
    assert.equal(
      getDueDate({ LastDoneDate: '', IntervalDays: '90' }),
      null,
    );
  });

  it('returns null when IntervalDays is empty', () => {
    assert.equal(
      getDueDate({ LastDoneDate: '2025-09-01', IntervalDays: '' }),
      null,
    );
  });
});

describe('getDueMiles', () => {
  it('adds IntervalMiles to LastDoneMiles', () => {
    assert.equal(
      getDueMiles({ LastDoneMiles: '145200', IntervalMiles: '10000' }),
      155200,
    );
  });

  it('returns null when LastDoneMiles is empty', () => {
    assert.equal(
      getDueMiles({ LastDoneMiles: '', IntervalMiles: '10000' }),
      null,
    );
  });

  it('returns null when IntervalMiles is empty', () => {
    assert.equal(
      getDueMiles({ LastDoneMiles: '145200', IntervalMiles: '' }),
      null,
    );
  });
});

describe('isOverdue', () => {
  describe('time-based', () => {
    it('returns true when today is past the due date', () => {
      assert.equal(
        isOverdue({ LastDoneDate: '2025-01-01', IntervalDays: '90' }, '2026-03-17', null),
        true,
      );
    });

    it('returns false when today is before the due date', () => {
      assert.equal(
        isOverdue({ LastDoneDate: '2026-03-01', IntervalDays: '90' }, '2026-03-17', null),
        false,
      );
    });

    it('returns true when today is one day past due date', () => {
      // Due date is 2026-03-16 (15 days after 2026-03-01), today is 17th
      assert.equal(
        isOverdue({ LastDoneDate: '2026-03-01', IntervalDays: '15' }, '2026-03-17', null),
        true,
      );
    });

    it('returns false when today equals the due date', () => {
      // Due date is 2026-03-17 (16 days after 2026-03-01), today is 17th
      assert.equal(
        isOverdue({ LastDoneDate: '2026-03-01', IntervalDays: '16' }, '2026-03-17', null),
        false,
      );
    });
  });

  describe('mileage-based', () => {
    it('returns true when currentMiles equals due mileage', () => {
      assert.equal(
        isOverdue({ LastDoneMiles: '100000', IntervalMiles: '10000' }, '2026-03-17', 110000),
        true,
      );
    });

    it('returns false when currentMiles is one below due mileage', () => {
      assert.equal(
        isOverdue({ LastDoneMiles: '100000', IntervalMiles: '10000' }, '2026-03-17', 109999),
        false,
      );
    });
  });

  describe('missing data', () => {
    it('returns false when no schedule configured', () => {
      assert.equal(
        isOverdue({ IntervalDays: '', LastDoneDate: '' }, '2026-03-17', null),
        false,
      );
    });

    it('returns false when LastDoneDate is missing', () => {
      assert.equal(
        isOverdue({ IntervalDays: '90' }, '2026-03-17', null),
        false,
      );
    });

    it('returns false when IntervalDays and IntervalMiles are both missing', () => {
      assert.equal(
        isOverdue({ LastDoneDate: '2025-01-01', LastDoneMiles: '100000' }, '2026-03-17', 200000),
        false,
      );
    });
  });
});

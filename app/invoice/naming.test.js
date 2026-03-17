import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBaseName, buildFolderPath, getServiceLabel } from './naming.js';

describe('getBaseName', () => {
  it('returns UNIT_DATE_TYPE for valid inputs', () => {
    assert.equal(getBaseName('TR-042', 'oil-change', '2026-03-16'), 'TR-042_2026-03-16_oil-change');
  });

  it('handles different unit and service types', () => {
    assert.equal(getBaseName('TL-017', 'dot-inspection', '2026-03-10'), 'TL-017_2026-03-10_dot-inspection');
  });

  it('returns null for missing unitId', () => {
    assert.equal(getBaseName('', 'oil-change', '2026-03-16'), null);
  });

  it('returns null for missing service', () => {
    assert.equal(getBaseName('TR-042', '', '2026-03-16'), null);
  });

  it('returns null for missing date', () => {
    assert.equal(getBaseName('TR-042', 'oil-change', ''), null);
  });
});

describe('buildFolderPath', () => {
  it('returns Fleet Maintenance/UNIT/Invoices', () => {
    assert.equal(buildFolderPath('TR-042'), 'Fleet Maintenance/TR-042/Invoices');
  });

  it('works with different unit IDs', () => {
    assert.equal(buildFolderPath('TL-017'), 'Fleet Maintenance/TL-017/Invoices');
  });

  it('accepts optional basePath override', () => {
    assert.equal(buildFolderPath('TR-042', 'Custom Base'), 'Custom Base/TR-042/Invoices');
  });
});

describe('getServiceLabel', () => {
  it('returns selectValue as-is for non-other values', () => {
    assert.equal(getServiceLabel('oil-change', ''), 'oil-change');
  });

  it('returns slugified otherText when selectValue is other', () => {
    assert.equal(getServiceLabel('other', 'Suspension Repair'), 'suspension-repair');
  });

  it('returns other when selectValue is other and otherText is empty', () => {
    assert.equal(getServiceLabel('other', ''), 'other');
  });

  it('returns empty string for empty selectValue', () => {
    assert.equal(getServiceLabel('', ''), '');
  });
});

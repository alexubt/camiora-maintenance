import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBaseName, buildFolderPath, getServiceLabel, getUnitCategory } from './naming.js';

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

describe('getUnitCategory', () => {
  it('maps TR prefix to Trucks', () => {
    assert.equal(getUnitCategory('TR-042'), 'Trucks');
  });

  it('maps TRK prefix to Trucks', () => {
    assert.equal(getUnitCategory('TRK-100'), 'Trucks');
  });

  it('maps TL prefix to Trailers', () => {
    assert.equal(getUnitCategory('TL-017'), 'Trailers');
  });

  it('maps TRL prefix to Trailers', () => {
    assert.equal(getUnitCategory('TRL-050'), 'Trailers');
  });

  it('maps RF prefix to Reefers', () => {
    assert.equal(getUnitCategory('RF-003'), 'Reefers');
  });

  it('falls back to Other for unknown prefix', () => {
    assert.equal(getUnitCategory('XX-001'), 'Other');
  });
});

describe('buildFolderPath', () => {
  it('returns Category/Unit/Year/Invoices structure', () => {
    assert.equal(
      buildFolderPath('TR-042', { date: '2026-03-16' }),
      'Fleet Maintenance/Trucks/TR-042/2026/Invoices'
    );
  });

  it('categorizes trailers correctly', () => {
    assert.equal(
      buildFolderPath('TL-017', { date: '2026-03-10' }),
      'Fleet Maintenance/Trailers/TL-017/2026/Invoices'
    );
  });

  it('categorizes reefers correctly', () => {
    assert.equal(
      buildFolderPath('RF-003', { date: '2025-12-01' }),
      'Fleet Maintenance/Reefers/RF-003/2025/Invoices'
    );
  });

  it('accepts custom docType', () => {
    assert.equal(
      buildFolderPath('TR-042', { date: '2026-03-16', docType: 'DOT Inspection' }),
      'Fleet Maintenance/Trucks/TR-042/2026/DOT Inspection'
    );
  });

  it('accepts optional basePath override', () => {
    assert.equal(
      buildFolderPath('TR-042', { date: '2026-01-01', basePath: 'Custom Base' }),
      'Custom Base/Trucks/TR-042/2026/Invoices'
    );
  });

  it('defaults to current year when no date provided', () => {
    const currentYear = new Date().getFullYear().toString();
    assert.ok(buildFolderPath('TR-042').includes(`/${currentYear}/`));
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

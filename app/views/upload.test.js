/**
 * Upload view naming contract tests.
 * Verifies the pure functions the upload form depends on
 * are correctly importable and produce expected outputs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBaseName, buildFolderPath, getServiceLabel } from '../invoice/naming.js';

describe('upload view naming contracts', () => {
  it('getBaseName produces UNIT_DATE_TYPE format', () => {
    assert.equal(getBaseName('TR-042', 'oil-change', '2026-03-16'), 'TR-042_2026-03-16_oil-change');
  });

  it('getBaseName returns null when any arg is empty', () => {
    assert.equal(getBaseName('', 'oil-change', '2026-03-16'), null);
    assert.equal(getBaseName('TR-042', '', '2026-03-16'), null);
    assert.equal(getBaseName('TR-042', 'oil-change', ''), null);
  });

  it('buildFolderPath returns categorized folder structure', () => {
    assert.equal(buildFolderPath('TR-042', { type: 'Truck', date: '2026-03-16' }), 'Fleet Maintenance/Trucks/TR-042/2026/Invoices');
  });

  it('getServiceLabel returns select value for non-other', () => {
    assert.equal(getServiceLabel('oil-change', ''), 'oil-change');
  });

  it('getServiceLabel returns slugified other text', () => {
    assert.equal(getServiceLabel('other', 'Brake Job'), 'brake-job');
  });

  it('getServiceLabel returns "other" when other text is empty', () => {
    assert.equal(getServiceLabel('other', ''), 'other');
  });
});

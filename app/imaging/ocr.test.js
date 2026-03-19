/**
 * Unit tests for OCR parsing functions.
 * Tests the text-only fallback parser (parseInvoiceFields) and
 * verifies spatial scoring helpers are importable.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceFields } from './ocr.js';

// Mock state.fleet.units for fleet-matching tests
import { state } from '../state.js';

describe('parseInvoiceFields (text fallback)', () => {
  beforeEach(() => {
    // Set up fleet roster for matching
    state.fleet.units = [
      { UnitId: '1022', Type: 'Truck' },
      { UnitId: '2045', Type: 'Trailer' },
      { UnitId: 'RF-003', Type: 'Reefer' },
      { UnitId: 'MACK-7', Type: 'Truck' },
    ];
  });

  it('matches a fleet unit ID from text', () => {
    const result = parseInvoiceFields('Invoice for unit 1022\nDate: 03/19/2026');
    assert.strictEqual(result.unitNumber, '1022');
    assert.strictEqual(result.date, '03/19/2026');
  });

  it('matches a fleet unit with alphanumeric ID', () => {
    const result = parseInvoiceFields('RF-003 brake inspection');
    assert.strictEqual(result.unitNumber, 'RF-003');
    assert.strictEqual(result.serviceType, 'brake-inspection');
  });

  it('prefers longer fleet ID matches', () => {
    state.fleet.units = [
      { UnitId: '10', Type: 'Truck' },
      { UnitId: '1022', Type: 'Truck' },
    ];
    const result = parseInvoiceFields('Service for 1022 completed');
    assert.strictEqual(result.unitNumber, '1022');
  });

  it('falls back to regex when no fleet match', () => {
    state.fleet.units = [];
    const result = parseInvoiceFields('TR-042 oil change 2026-03-16');
    assert.strictEqual(result.unitNumber, '042');
    assert.strictEqual(result.unitRaw, 'TR-042');
    assert.strictEqual(result.date, '2026-03-16');
    assert.strictEqual(result.serviceType, 'oil-change');
  });

  it('extracts date in ISO format', () => {
    const result = parseInvoiceFields('Date: 2026-03-16');
    assert.strictEqual(result.date, '2026-03-16');
  });

  it('extracts date in US slash format', () => {
    const result = parseInvoiceFields('Invoice date: 03/19/2026');
    assert.strictEqual(result.date, '03/19/2026');
  });

  it('extracts service type keywords', () => {
    const result = parseInvoiceFields('Oil change service completed');
    assert.strictEqual(result.serviceType, 'oil-change');
  });

  it('extracts DOT inspection', () => {
    const result = parseInvoiceFields('DOT inspection passed');
    assert.strictEqual(result.serviceType, 'dot-inspection');
  });

  it('extracts PM service', () => {
    const result = parseInvoiceFields('PM service at 120000 miles');
    assert.strictEqual(result.serviceType, 'pm-service');
  });

  it('returns nulls when no recognizable data', () => {
    const result = parseInvoiceFields('random text with no invoice data');
    assert.strictEqual(result.unitNumber, null);
    assert.strictEqual(result.date, null);
    assert.strictEqual(result.serviceType, null);
  });

  it('returns rawText', () => {
    const input = 'some text';
    assert.strictEqual(parseInvoiceFields(input).rawText, input);
  });

  it('handles Unit #1234 format when no fleet match', () => {
    state.fleet.units = [];
    const result = parseInvoiceFields('Unit #1234 oil change');
    assert.strictEqual(result.unitNumber, '1234');
  });

  it('handles Truck #042 format when no fleet match', () => {
    state.fleet.units = [];
    const result = parseInvoiceFields('Truck #042 brake inspection');
    assert.strictEqual(result.unitNumber, '042');
  });
});

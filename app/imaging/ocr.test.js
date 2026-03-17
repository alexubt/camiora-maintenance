/**
 * Unit tests for parseInvoiceFields in ocr.js
 * Uses Node.js built-in test runner (node:test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceFields } from './ocr.js';

describe('parseInvoiceFields', () => {
  it('extracts unit, date, and service type from a full invoice string', () => {
    const result = parseInvoiceFields('Invoice for TR-042\nDate: 2026-03-16\nOil change service');
    assert.deepStrictEqual(result, {
      unitNumber: '042',
      date: '2026-03-16',
      serviceType: 'oil-change',
    });
  });

  it('handles alternate unit format TRK with single digit (pads to 3)', () => {
    const result = parseInvoiceFields('TRK 7 brake inspection 01/15/2026');
    assert.deepStrictEqual(result, {
      unitNumber: '007',
      date: '01/15/2026',
      serviceType: 'brake-inspection',
    });
  });

  it('handles trailer format TL-123 with DOT inspection', () => {
    const result = parseInvoiceFields('TL-123 DOT inspection');
    assert.deepStrictEqual(result, {
      unitNumber: '123',
      date: null,
      serviceType: 'dot-inspection',
    });
  });

  it('returns all nulls when no recognizable invoice data is present', () => {
    const result = parseInvoiceFields('random text with no invoice data');
    assert.deepStrictEqual(result, {
      unitNumber: null,
      date: null,
      serviceType: null,
    });
  });

  it('handles partial data — only date present', () => {
    const result = parseInvoiceFields('Service performed on 2026-03-16 at the shop');
    assert.deepStrictEqual(result, {
      unitNumber: null,
      date: '2026-03-16',
      serviceType: null,
    });
  });

  it('handles trailer format TRL with PM service', () => {
    const result = parseInvoiceFields('TRL 45 PM service 03/01/2026');
    assert.deepStrictEqual(result, {
      unitNumber: '045',
      date: '03/01/2026',
      serviceType: 'pm-service',
    });
  });

  it('picks first matching service keyword when multiple are present', () => {
    // "oil" appears before "brake" in the svcMap iteration order
    const result = parseInvoiceFields('TR-100 oil change and brake inspection 2026-01-01');
    assert.deepStrictEqual(result, {
      unitNumber: '100',
      date: '2026-01-01',
      serviceType: 'oil-change',
    });
  });

  it('handles US slash date format', () => {
    const result = parseInvoiceFields('Invoice date: 03/16/2026');
    assert.deepStrictEqual(result, {
      unitNumber: null,
      date: '03/16/2026',
      serviceType: null,
    });
  });

  it('handles partial data — only unit number present', () => {
    const result = parseInvoiceFields('Serviced unit TR-055 at the shop');
    assert.deepStrictEqual(result, {
      unitNumber: '055',
      date: null,
      serviceType: null,
    });
  });
});

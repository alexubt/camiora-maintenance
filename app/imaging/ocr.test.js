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
    assert.strictEqual(result.unitNumber, '042');
    assert.strictEqual(result.unitRaw, 'TR-042');
    assert.strictEqual(result.date, '2026-03-16');
    assert.strictEqual(result.serviceType, 'oil-change');
    assert.strictEqual(typeof result.rawText, 'string');
  });

  it('handles alternate unit format TRK with single digit (pads to 3)', () => {
    const result = parseInvoiceFields('TRK 7 brake inspection 01/15/2026');
    assert.strictEqual(result.unitNumber, '007');
    assert.strictEqual(result.date, '01/15/2026');
    assert.strictEqual(result.serviceType, 'brake-inspection');
  });

  it('handles trailer format TL-123 with DOT inspection', () => {
    const result = parseInvoiceFields('TL-123 DOT inspection');
    assert.strictEqual(result.unitNumber, '123');
    assert.strictEqual(result.unitRaw, 'TL-123');
    assert.strictEqual(result.date, null);
    assert.strictEqual(result.serviceType, 'dot-inspection');
  });

  it('returns all nulls when no recognizable invoice data is present', () => {
    const result = parseInvoiceFields('random text with no invoice data');
    assert.strictEqual(result.unitNumber, null);
    assert.strictEqual(result.unitRaw, null);
    assert.strictEqual(result.date, null);
    assert.strictEqual(result.serviceType, null);
  });

  it('handles partial data — only date present', () => {
    const result = parseInvoiceFields('Service performed on 2026-03-16 at the shop');
    assert.strictEqual(result.unitNumber, null);
    assert.strictEqual(result.date, '2026-03-16');
    assert.strictEqual(result.serviceType, null);
  });

  it('handles trailer format TRL with PM service', () => {
    const result = parseInvoiceFields('TRL 45 PM service 03/01/2026');
    assert.strictEqual(result.unitNumber, '045');
    assert.strictEqual(result.date, '03/01/2026');
    assert.strictEqual(result.serviceType, 'pm-service');
  });

  it('picks first matching service keyword when multiple are present', () => {
    // "oil" appears before "brake" in the svcMap iteration order
    const result = parseInvoiceFields('TR-100 oil change and brake inspection 2026-01-01');
    assert.strictEqual(result.unitNumber, '100');
    assert.strictEqual(result.date, '2026-01-01');
    assert.strictEqual(result.serviceType, 'oil-change');
  });

  it('handles US slash date format', () => {
    const result = parseInvoiceFields('Invoice date: 03/16/2026');
    assert.strictEqual(result.unitNumber, null);
    assert.strictEqual(result.date, '03/16/2026');
    assert.strictEqual(result.serviceType, null);
  });

  it('handles partial data — only unit number present', () => {
    const result = parseInvoiceFields('Serviced unit TR-055 at the shop');
    assert.strictEqual(result.unitNumber, '055');
    assert.strictEqual(result.unitRaw, 'TR-055');
    assert.strictEqual(result.date, null);
    assert.strictEqual(result.serviceType, null);
  });

  // New tests for broader unit patterns
  it('matches "Unit #1234" format', () => {
    const result = parseInvoiceFields('Unit #1234 oil change');
    assert.strictEqual(result.unitNumber, '1234');
    assert.strictEqual(result.unitRaw, 'Unit #1234');
    assert.strictEqual(result.serviceType, 'oil-change');
  });

  it('matches "Truck #042" format', () => {
    const result = parseInvoiceFields('Truck #042 brake inspection 2026-01-15');
    assert.strictEqual(result.unitNumber, '042');
    assert.strictEqual(result.serviceType, 'brake-inspection');
  });

  it('matches "Trailer 123" format', () => {
    const result = parseInvoiceFields('Trailer 123 PM service');
    assert.strictEqual(result.unitNumber, '123');
    assert.strictEqual(result.serviceType, 'pm-service');
  });

  it('returns rawText containing the original input', () => {
    const input = 'TR-042 oil change 2026-03-16';
    const result = parseInvoiceFields(input);
    assert.strictEqual(result.rawText, input);
  });
});

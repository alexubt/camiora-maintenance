import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, serializeCSV, hashText, downloadCSV, writeCSVWithLock } from './csv.js';

// --- Pure function tests (no mocking needed) ---

describe('parseCSV', () => {
  it('parses valid CSV into array of objects', () => {
    const result = parseCSV('UnitId,Type,Number\nTRK-001,Truck,001');
    assert.deepStrictEqual(result, [{ UnitId: 'TRK-001', Type: 'Truck', Number: '001' }]);
  });

  it('returns empty array for null input', () => {
    assert.deepStrictEqual(parseCSV(null), []);
  });

  it('returns empty array for empty string', () => {
    assert.deepStrictEqual(parseCSV(''), []);
  });

  it('returns empty array for header-only input', () => {
    assert.deepStrictEqual(parseCSV('UnitId,Type'), []);
  });

  it('trims whitespace from values', () => {
    const result = parseCSV('A,B\n  foo , bar ');
    assert.deepStrictEqual(result, [{ A: 'foo', B: 'bar' }]);
  });
});

describe('serializeCSV', () => {
  it('serializes headers and rows to CSV text', () => {
    const headers = ['A', 'B'];
    const rows = [{ A: '1', B: '2' }, { A: '3', B: '4' }];
    assert.equal(serializeCSV(headers, rows), 'A,B\n1,2\n3,4');
  });
});

describe('hashText', () => {
  it('produces a consistent 64-char hex string', async () => {
    const h = await hashText('hello');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
    // Same input gives same output
    const h2 = await hashText('hello');
    assert.equal(h, h2);
  });

  it('produces different hashes for different input', async () => {
    const h1 = await hashText('hello');
    const h2 = await hashText('hello2');
    assert.notEqual(h1, h2);
  });
});

// --- Fetch-dependent tests (mock globalThis.fetch) ---

describe('downloadCSV', () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns {text: null, hash: null} on 404', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const result = await downloadCSV('some/path.csv', 'fake-token');
    assert.deepStrictEqual(result, { text: null, hash: null });
  });

  it('returns text and hash on success', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => 'UnitId,Type\nTRK-001,Truck',
    });
    const result = await downloadCSV('some/path.csv', 'fake-token');
    assert.equal(typeof result.text, 'string');
    assert.equal(typeof result.hash, 'string');
    assert.equal(result.hash.length, 64);
  });

  it('normalizes CRLF line endings before hashing', async () => {
    const content = 'A,B\r\nfoo,bar\r\n';
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => content,
    });
    const result = await downloadCSV('path.csv', 'token');

    // The returned text should be LF-normalized
    assert.ok(!result.text.includes('\r'), 'CRLF should be normalized to LF');

    // Hash should match hash of LF-normalized text
    const expectedHash = await hashText(content.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    assert.equal(result.hash, expectedHash);
  });
});

describe('writeCSVWithLock', () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws CSV_CONFLICT when hash has changed', async () => {
    // Mock: downloadCSV will call fetch for GET, returning different content
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      // First call is the re-download check inside writeCSVWithLock
      return {
        ok: true,
        status: 200,
        text: async () => 'changed,content',
        json: async () => ({}),
      };
    };

    // Pass an originalHash that won't match the re-downloaded content
    await assert.rejects(
      () => writeCSVWithLock('path.csv', 'stale-hash-value', 'new,data', 'token'),
      (err) => {
        assert.equal(err.code, 'CSV_CONFLICT');
        return true;
      }
    );
  });

  it('succeeds when hash matches', async () => {
    const csvContent = 'A,B\n1,2';
    const correctHash = await hashText(csvContent);

    let callCount = 0;
    globalThis.fetch = async (url, opts) => {
      callCount++;
      if (!opts || opts.method !== 'PUT') {
        // GET request (re-download)
        return {
          ok: true,
          status: 200,
          text: async () => csvContent,
        };
      }
      // PUT request
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'drive-item-123' }),
      };
    };

    const result = await writeCSVWithLock('path.csv', correctHash, 'A,B\n1,2\n3,4', 'token');
    assert.equal(result.id, 'drive-item-123');
  });
});

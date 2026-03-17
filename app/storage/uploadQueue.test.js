import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueUpload, dequeueAll, removeJob } from './uploadQueue.js';

/**
 * Minimal in-memory IDB mock for testing.
 * Uses a Map to simulate an auto-incrementing object store.
 */
function makeMockDB() {
  let autoId = 0;
  const store = new Map();

  return {
    _store: store,
    openDB: async () => ({
      /** Simulate IDB transaction API */
      transaction(storeName, mode) {
        return {
          objectStore() {
            return {
              put(job) {
                const id = job.id || ++autoId;
                store.set(id, { ...job, id });
                const req = { result: id, _onerror: null, _onsuccess: null };
                Object.defineProperty(req, 'onsuccess', { set(fn) { req._onsuccess = fn; fn(); } });
                Object.defineProperty(req, 'onerror', { set(fn) { req._onerror = fn; } });
                return req;
              },
              getAll() {
                const result = [...store.values()];
                const req = { result, _onsuccess: null, _onerror: null };
                Object.defineProperty(req, 'onsuccess', { set(fn) { req._onsuccess = fn; fn(); } });
                Object.defineProperty(req, 'onerror', { set(fn) { req._onerror = fn; } });
                return req;
              },
              delete(id) {
                store.delete(id);
                const req = { _onsuccess: null, _onerror: null };
                Object.defineProperty(req, 'onsuccess', { set(fn) { req._onsuccess = fn; fn(); } });
                Object.defineProperty(req, 'onerror', { set(fn) { req._onerror = fn; } });
                return req;
              },
            };
          },
        };
      },
    }),
  };
}

describe('uploadQueue', () => {
  it('enqueue adds a job and returns an id', async () => {
    const mock = makeMockDB();
    const job = {
      pdfBlob: new Blob(['test'], { type: 'application/pdf' }),
      remotePath: 'Fleet/TR-042/file.pdf',
      folderPath: 'Fleet/TR-042',
      csvRow: { InvoiceId: 'x1', UnitId: 'TR-042', Date: '2026-03-17', Type: 'oil-change', Cost: '100', PdfPath: 'Fleet/TR-042/file.pdf' },
    };
    const id = await enqueueUpload(job, mock.openDB);
    assert.ok(id, 'should return an id');
    assert.equal(mock._store.size, 1);
  });

  it('enqueue adds queuedAt timestamp', async () => {
    const mock = makeMockDB();
    const job = {
      pdfBlob: new Blob(['test']),
      remotePath: 'a/b.pdf',
      folderPath: 'a',
      csvRow: {},
    };
    await enqueueUpload(job, mock.openDB);
    const stored = [...mock._store.values()][0];
    assert.ok(stored.queuedAt, 'should have queuedAt');
    // Should be a valid ISO string
    assert.ok(!isNaN(Date.parse(stored.queuedAt)), 'queuedAt should be ISO date string');
  });

  it('dequeueAll returns all queued jobs sorted by queuedAt', async () => {
    const mock = makeMockDB();
    await enqueueUpload({ pdfBlob: new Blob(['']), remotePath: 'a', folderPath: 'a', csvRow: {} }, mock.openDB);
    await enqueueUpload({ pdfBlob: new Blob(['']), remotePath: 'b', folderPath: 'b', csvRow: {} }, mock.openDB);
    const jobs = await dequeueAll(mock.openDB);
    assert.equal(jobs.length, 2);
    // Oldest first
    assert.equal(jobs[0].remotePath, 'a');
    assert.equal(jobs[1].remotePath, 'b');
  });

  it('dequeueAll returns empty array when queue is empty', async () => {
    const mock = makeMockDB();
    const jobs = await dequeueAll(mock.openDB);
    assert.deepStrictEqual(jobs, []);
  });

  it('removeJob deletes a specific job by id', async () => {
    const mock = makeMockDB();
    const id1 = await enqueueUpload({ pdfBlob: new Blob(['']), remotePath: 'a', folderPath: 'a', csvRow: {} }, mock.openDB);
    const id2 = await enqueueUpload({ pdfBlob: new Blob(['']), remotePath: 'b', folderPath: 'b', csvRow: {} }, mock.openDB);
    await removeJob(id1, mock.openDB);
    const remaining = await dequeueAll(mock.openDB);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].remotePath, 'b');
  });
});

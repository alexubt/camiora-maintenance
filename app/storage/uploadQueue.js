/**
 * IndexedDB queue for pending offline uploads.
 * Stores PDF blobs and metadata for automatic retry when connectivity returns.
 * Native ES module.
 */

import { openDB as defaultOpenDB } from './db.js';

const STORE_NAME = 'uploadQueue';

/**
 * Add a job to the upload queue.
 * @param {{ pdfBlob: Blob, remotePath: string, folderPath: string, csvRow: object }} job
 * @param {Function} [dbProvider] - Optional DB opener for testing (DI)
 * @returns {Promise<number>} Generated job id
 */
export async function enqueueUpload(job, dbProvider = defaultOpenDB) {
  const db = await dbProvider();
  const entry = { ...job, queuedAt: new Date().toISOString() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(entry);
    req.onsuccess = () => resolve(req.result || entry.id);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all queued jobs, sorted oldest-first by queuedAt.
 * @param {Function} [dbProvider] - Optional DB opener for testing (DI)
 * @returns {Promise<Array>}
 */
export async function dequeueAll(dbProvider = defaultOpenDB) {
  const db = await dbProvider();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const jobs = req.result || [];
      jobs.sort((a, b) => (a.queuedAt || '').localeCompare(b.queuedAt || ''));
      resolve(jobs);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove a completed or failed job from the queue.
 * @param {number} id - Job id
 * @param {Function} [dbProvider] - Optional DB opener for testing (DI)
 * @returns {Promise<void>}
 */
export async function removeJob(id, dbProvider = defaultOpenDB) {
  const db = await dbProvider();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

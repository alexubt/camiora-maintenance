/**
 * Shared IndexedDB opener for the camiora database.
 * Both cache.js and uploadQueue.js import from here to avoid version conflicts.
 * Native ES module.
 */

const DB_NAME = 'camiora';
const DB_VERSION = 2;

/**
 * Open (or create/upgrade) the IndexedDB database.
 * Creates both 'fleet' and 'uploadQueue' object stores.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('fleet')) {
        db.createObjectStore('fleet');
      }
      if (!db.objectStoreNames.contains('uploadQueue')) {
        db.createObjectStore('uploadQueue', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

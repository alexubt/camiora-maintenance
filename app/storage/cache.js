/**
 * IndexedDB fleet cache — offline read/write for unit roster snapshots.
 * Native ES module. No library dependencies.
 */

const DB_NAME = 'camiora';
const DB_VERSION = 1;
const STORE_NAME = 'fleet';

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Read cached fleet data from IndexedDB.
 * @returns {Promise<{units: Array, hash: string}|null>}
 */
export async function getCachedFleet() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('units');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Write fleet data to IndexedDB cache.
 * @param {{units: Array, hash: string}} data
 * @returns {Promise<void>}
 */
export async function setCachedFleet(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(data, 'units');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

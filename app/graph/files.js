/**
 * OneDrive folder and file upload functions.
 * Native ES module.
 */

import { GRAPH, getValidToken } from './auth.js';

/**
 * Ensure a nested folder path exists in OneDrive, creating missing segments.
 * Uses segment-by-segment path encoding (Pitfall 5 fix).
 * @param {string} folderPath — e.g. "Fleet Maintenance/Trucks/TR-042/Maintenance"
 */
export async function ensureFolder(folderPath) {
  const token = await getValidToken();
  if (!token) throw new Error('AUTH_EXPIRED');

  const parts = folderPath.split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const encoded = current.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${GRAPH}/me/drive/root:/${encoded}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 404) {
      const parent    = current.includes('/') ? current.substring(0, current.lastIndexOf('/')) : '';
      const parentEncoded = parent
        ? parent.split('/').map(encodeURIComponent).join('/')
        : '';
      const parentUrl = parentEncoded
        ? `${GRAPH}/me/drive/root:/${parentEncoded}:/children`
        : `${GRAPH}/me/drive/root/children`;
      await fetch(parentUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' })
      });
    }
  }
}

/**
 * Upload a file to a OneDrive path.
 * Uses segment-by-segment path encoding (Pitfall 5 fix).
 * @param {File} file
 * @param {string} remotePath — e.g. "Fleet Maintenance/Trucks/TR-042/Maintenance/file.pdf"
 */
export async function uploadFile(file, remotePath) {
  const token = await getValidToken();
  if (!token) throw new Error('AUTH_EXPIRED');

  const encoded = remotePath.split('/').map(encodeURIComponent).join('/');
  const url  = `${GRAPH}/me/drive/root:/${encoded}:/content`;
  const resp = await fetch(url, {
    method:  'PUT',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!resp.ok) throw new Error(`Upload failed ${resp.status}`);
  return resp.json();
}

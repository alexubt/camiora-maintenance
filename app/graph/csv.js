/**
 * CSV data layer — download, parse, serialize, hash, optimistic-lock write.
 * Native ES module. No dependencies beyond browser built-ins.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * SHA-256 hex digest of a text string.
 * @param {string} text
 * @returns {Promise<string>} 64-char lowercase hex string
 */
export async function hashText(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Download a CSV file from OneDrive via Graph API.
 * Normalizes line endings to LF before returning.
 * @param {string} remotePath — e.g. "Fleet Maintenance/data/units.csv"
 * @param {string} token — Bearer access token
 * @returns {Promise<{text: string|null, hash: string|null}>}
 */
export async function downloadCSV(remotePath, token) {
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GRAPH}/me/drive/root:/${encodedPath}:/content`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    return { text: null, hash: null };
  }

  let text = await resp.text();
  // Normalize CRLF and lone CR to LF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const hash = await hashText(text);
  return { text, hash };
}

/**
 * Parse CSV text into an array of objects keyed by header row.
 * @param {string|null} text
 * @returns {Array<Object>}
 */
export function parseCSV(text) {
  if (!text) return [];

  const lines = text.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((key, i) => {
      obj[key] = values[i] !== undefined ? values[i] : '';
    });
    return obj;
  });
}

/**
 * Serialize an array of row objects back to CSV text.
 * @param {string[]} headers — column order
 * @param {Array<Object>} rows
 * @returns {string}
 */
export function serializeCSV(headers, rows) {
  const headerLine = headers.join(',');
  const dataLines = rows.map(row =>
    headers.map(h => row[h] !== undefined ? row[h] : '').join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

/**
 * Write CSV with optimistic lock: re-downloads to check hash,
 * throws CSV_CONFLICT if stale, otherwise PUTs new content.
 * @param {string} remotePath
 * @param {string} originalHash — hash from last download
 * @param {string} newCSVText — new CSV content to write
 * @param {string} token
 * @returns {Promise<Object>} driveItem JSON from Graph API
 */
export async function writeCSVWithLock(remotePath, originalHash, newCSVText, token) {
  const { hash: currentHash } = await downloadCSV(remotePath, token);

  if (currentHash !== originalHash) {
    const err = new Error('CSV content has changed since last read');
    err.code = 'CSV_CONFLICT';
    throw err;
  }

  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GRAPH}/me/drive/root:/${encodedPath}:/content`;

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: newCSVText,
  });

  if (!resp.ok) {
    throw new Error(`CSV upload failed: ${resp.status}`);
  }

  return resp.json();
}

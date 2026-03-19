/**
 * Unit detail view — invoice history, PM schedule, condition tracking.
 * Native ES module. Follows upload.js patterns for event delegation and toast.
 */

import { state } from '../state.js';
import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock } from '../graph/csv.js';
import { getValidToken } from '../graph/auth.js';
// schedule.js no longer needed — PM Schedule removed, milestones handle tracking
import { TIRE_POSITIONS, getMilestonesForCategory, getMilestoneStatus } from '../maintenance/milestones.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAINTENANCE_HEADERS = ['MaintId', 'UnitId', 'Type', 'IntervalDays', 'IntervalMiles', 'LastDoneDate', 'LastDoneMiles', 'Notes'];
const CONDITION_HEADERS = ['UnitId', 'CurrentMiles', 'DotExpiry', 'TireNotes', 'LastUpdated'];


/** Default csv operations — wired to real graph/csv.js functions */
const defaultCsvOps = { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock };

// ── Pure / DI functions (exported for testing) ────────────────────────────────

/**
 * Escape HTML entities in a string for safe innerHTML use.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Determine DOT inspection status relative to today.
 * @param {string|null} dotExpiry - YYYY-MM-DD
 * @param {string} todayStr - YYYY-MM-DD
 * @returns {'expired'|'warning'|'ok'|'unknown'}
 */
export function dotStatus(dotExpiry, todayStr) {
  if (!dotExpiry) return 'unknown';
  if (dotExpiry < todayStr) return 'expired';

  // Check if within 30 days
  const expiry = new Date(dotExpiry + 'T00:00:00');
  const today = new Date(todayStr + 'T00:00:00');
  const diffMs = expiry.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays <= 30) return 'warning';

  return 'ok';
}

/**
 * Load all data for a single unit from the three CSV sources.
 * @param {string} unitId
 * @param {string} token
 * @param {{invoicesPath: string, maintenancePath: string, conditionPath: string}} paths
 * @param {object} csvOps - DI for testing
 * @returns {Promise<{invoices: Array, maintenance: Array, condition: object|null, maintenanceHash: string|null, conditionHash: string|null}>}
 */
export async function loadUnitData(unitId, token, paths, csvOps = defaultCsvOps) {
  const [invResult, maintResult, condResult] = await Promise.allSettled([
    csvOps.downloadCSV(paths.invoicesPath, token),
    csvOps.downloadCSV(paths.maintenancePath, token),
    csvOps.downloadCSV(paths.conditionPath, token),
  ]);

  const invData = invResult.status === 'fulfilled' ? invResult.value : { text: null, hash: null };
  const maintData = maintResult.status === 'fulfilled' ? maintResult.value : { text: null, hash: null };
  const condData = condResult.status === 'fulfilled' ? condResult.value : { text: null, hash: null };

  const allInvoices = csvOps.parseCSV(invData.text);
  const allMaintenance = csvOps.parseCSV(maintData.text);
  const allCondition = csvOps.parseCSV(condData.text);

  return {
    invoices: allInvoices.filter(r => r.UnitId === unitId),
    maintenance: allMaintenance.filter(r => r.UnitId === unitId),
    condition: allCondition.find(r => r.UnitId === unitId) || null,
    maintenanceHash: maintData.hash,
    conditionHash: condData.hash,
  };
}

/**
 * Save condition data for a unit. Row-update if exists, row-create if new.
 * @param {string} unitId
 * @param {object} updates - { CurrentMiles, DotExpiry, TireNotes }
 * @param {string} token
 * @param {string} conditionPath
 * @param {object} csvOps - DI for testing
 */
export async function saveConditionUpdate(unitId, updates, token, conditionPath, csvOps = defaultCsvOps) {
  const { text, hash } = await csvOps.downloadCSV(conditionPath, token);
  const rows = csvOps.parseCSV(text);

  const today = new Date().toISOString().split('T')[0];

  // Strip commas from text fields to prevent CSV breakage
  const cleanNotes = (updates.TireNotes || '').replace(/,/g, '');

  const idx = rows.findIndex(r => r.UnitId === unitId);
  if (idx >= 0) {
    // Update existing row in-place
    rows[idx].CurrentMiles = updates.CurrentMiles || rows[idx].CurrentMiles;
    rows[idx].DotExpiry = updates.DotExpiry || rows[idx].DotExpiry;
    rows[idx].TireNotes = cleanNotes || rows[idx].TireNotes;
    rows[idx].LastUpdated = today;
  } else {
    // Create new row
    rows.push({
      UnitId: unitId,
      CurrentMiles: updates.CurrentMiles || '',
      DotExpiry: updates.DotExpiry || '',
      TireNotes: cleanNotes,
      LastUpdated: today,
    });
  }

  const newText = csvOps.serializeCSV(CONDITION_HEADERS, rows);
  return await csvOps.writeCSVWithLock(conditionPath, hash, newText, token);
}

/**
 * Append a new maintenance schedule record.
 */
async function appendMaintenanceRecord(row, token, maintenancePath, maintenanceHash, csvOps = defaultCsvOps) {
  const { text, hash } = await csvOps.downloadCSV(maintenancePath, token);
  const rows = csvOps.parseCSV(text);

  // Strip commas from Notes
  row.Notes = (row.Notes || '').replace(/,/g, '');
  rows.push(row);

  const newText = csvOps.serializeCSV(MAINTENANCE_HEADERS, rows);
  return await csvOps.writeCSVWithLock(maintenancePath, hash, newText, token);
}

/**
 * Mark a maintenance record as done today.
 */
async function markDoneToday(maintId, currentMiles, token, maintenancePath, csvOps = defaultCsvOps) {
  const { text, hash } = await csvOps.downloadCSV(maintenancePath, token);
  const rows = csvOps.parseCSV(text);

  const today = new Date().toISOString().split('T')[0];
  const idx = rows.findIndex(r => r.MaintId === maintId);
  if (idx >= 0) {
    rows[idx].LastDoneDate = today;
    rows[idx].LastDoneMiles = String(currentMiles || '');
  }

  const newText = csvOps.serializeCSV(MAINTENANCE_HEADERS, rows);
  return await csvOps.writeCSVWithLock(maintenancePath, hash, newText, token);
}

// ── Badge HTML helpers ────────────────────────────────────────────────────────

function statusBadge(status, label) {
  const colors = {
    expired: 'background:#dc3545;color:#fff',
    overdue: 'background:#dc3545;color:#fff',
    warning: 'background:#ffc107;color:#333',
    ok: 'background:#28a745;color:#fff',
    unknown: 'background:#6c757d;color:#fff',
  };
  const style = colors[status] || colors.unknown;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;${style}">${escapeHtml(label || status)}</span>`;
}

// ── Render: main entry point ──────────────────────────────────────────────────

export function render(container, params = {}) {
  const unitId = params.id;

  if (!unitId) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="color:var(--text-2);">No unit specified.</p>
        <a href="#upload" style="color:var(--green-dark);">Back to upload</a>
      </div>`;
    return;
  }

  if (!state.token) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="color:var(--text-2);">Please sign in first.</p>
        <a href="#upload" style="color:var(--green-dark);">Back to sign in</a>
      </div>`;
    return;
  }

  // Show loading skeleton
  container.innerHTML = `
    <div style="padding:16px;">
      <a href="#upload" style="color:var(--green-dark);text-decoration:none;font-size:14px;">&#8592; Back</a>
      <h2 style="margin:12px 0 8px;">${escapeHtml(unitId)}</h2>
      <div style="color:var(--text-2);padding:40px 0;text-align:center;">Loading unit data...</div>
    </div>`;

  // Load data on-demand
  const paths = {
    invoicesPath: state.fleet.invoicesPath,
    maintenancePath: state.fleet.maintenancePath,
    conditionPath: state.fleet.conditionPath,
  };

  loadUnitData(unitId, state.token, paths).then(data => {
    // Store hashes for write operations
    state.fleet.maintenanceHash = data.maintenanceHash;
    state.fleet.conditionHash = data.conditionHash;

    renderUnitPage(container, unitId, data);
  }).catch(err => {
    console.error('Failed to load unit data:', err);
    container.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="color:#dc3545;">Failed to load data: ${escapeHtml(err.message)}</p>
        <a href="#upload" style="color:var(--green-dark);">Back to upload</a>
      </div>`;
  });
}

function renderUnitInfo(unitId, condition, today) {
  const unit = state.fleet.units.find(u => u.UnitId === unitId);
  if (!unit) return '<p style="color:var(--text-2);font-size:13px;margin:0 0 20px;">Unit not found in roster</p>';

  const currentMiles = condition ? Number(condition.CurrentMiles) || 0 : 0;
  const dotExpiry = unit.DotExpiry || '';
  const dotStat = dotExpiry ? dotStatus(dotExpiry, today) : 'unknown';

  const fields = [
    { label: 'Type', value: unit.Type },
    { label: 'Make / Model', value: [unit.Make, unit.Model].filter(Boolean).join(' ') || null },
    { label: 'Year', value: unit.Year },
    { label: 'VIN', value: unit.VIN },
    { label: 'Plate', value: unit.PlateNr },
    { label: 'DOT Expiry', value: dotExpiry, badge: dotExpiry ? statusBadge(dotStat, dotStat) : null },
    { label: 'Mileage', value: currentMiles ? currentMiles.toLocaleString() + ' mi' : null, editable: true },
  ].filter(f => f.value);

  return `
    <div style="background:var(--bg-2,#f8f9fa);border-radius:12px;padding:14px 16px;margin:8px 0 20px;">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px 16px;">
        ${fields.map(f => `
          <div>
            <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(f.label)}</div>
            <div style="font-size:14px;font-weight:500;margin-top:2px;">${escapeHtml(f.value)}${f.badge ? ' ' + f.badge : ''}</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
        <input type="text" id="editMiles" inputmode="numeric" placeholder="Update mileage"
          value="${currentMiles || ''}"
          style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;">
        <button data-action="save-mileage" style="background:var(--green-dark);color:#fff;border:none;padding:6px 14px;border-radius:8px;font-size:13px;cursor:pointer;">Update</button>
      </div>
    </div>`;
}

function renderUnitPage(container, unitId, data) {
  const today = new Date().toISOString().split('T')[0];
  const currentMiles = data.condition ? Number(data.condition.CurrentMiles) || 0 : 0;
  const unit = state.fleet.units.find(u => u.UnitId === unitId);
  const unitType = unit?.Type || 'Other';

  // Sort invoices by date descending
  const invoices = [...data.invoices].sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));

  // Get category-specific milestones
  const milestones = getMilestonesForCategory(unitType);

  container.innerHTML = `
    <div style="padding:16px;padding-bottom:80px;">
      <a href="#dashboard" style="color:var(--green-dark);text-decoration:none;font-size:14px;">&#8592; Back</a>
      <h2 style="margin:12px 0 4px;">${escapeHtml(unitId)}</h2>
      ${renderUnitInfo(unitId, data.condition, today)}

      <!-- Maintenance Milestones Section -->
      <div style="margin-bottom:20px;">
        <h3 style="margin:0 0 8px;font-size:16px;">Maintenance Milestones</h3>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid #dee2e6;text-align:left;">
                <th style="padding:8px 4px;">Milestone</th>
                <th style="padding:8px 4px;">Last Done</th>
                <th style="padding:8px 4px;">Interval</th>
                <th style="padding:8px 4px;">Next Due</th>
                <th style="padding:8px 4px;">Status</th>
                <th style="padding:8px 4px;"></th>
              </tr>
            </thead>
            <tbody>
              ${milestones.map(ms => {
                const s = getMilestoneStatus(ms, data.maintenance, currentMiles);
                const lastStr = s.lastDoneMiles != null ? Number(s.lastDoneMiles).toLocaleString() + ' mi' : '---';
                const intStr = ms.intervalMiles != null ? ms.intervalMiles.toLocaleString() + ' mi' : '---';
                const nextStr = s.nextDueMiles != null ? Number(s.nextDueMiles).toLocaleString() + ' mi' : '---';
                let badge;
                if (s.status === 'overdue') badge = statusBadge('overdue', 'Overdue');
                else if (s.status === 'ok') badge = statusBadge('ok', 'OK');
                else badge = statusBadge('unknown', 'N/A');
                return `<tr style="border-bottom:1px solid #eee;">
                  <td style="padding:8px 4px;">${escapeHtml(ms.label)}</td>
                  <td style="padding:8px 4px;">${lastStr}</td>
                  <td style="padding:8px 4px;">${intStr}</td>
                  <td style="padding:8px 4px;">${nextStr}</td>
                  <td style="padding:8px 4px;">${badge}</td>
                  <td style="padding:8px 4px;"><button data-action="milestone-done" data-milestone-type="${ms.type}" style="background:none;border:1px solid #999;color:#666;padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;">Done</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Notable Mentions -->
        <div style="margin-top:16px;background:var(--bg-2, #f8f9fa);border-radius:12px;padding:14px 16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:14px;">Notable Mentions</strong>
            <button data-action="edit-notable" style="background:none;border:1px solid var(--green-dark, #28a745);color:var(--green-dark, #28a745);padding:2px 10px;border-radius:8px;font-size:12px;cursor:pointer;">Edit</button>
          </div>
          <p id="notableText" style="margin:8px 0 0;font-size:13px;color:var(--text-1);">${escapeHtml(data.condition?.TireNotes || '---')}</p>
          <div id="notableForm" style="display:none;margin-top:8px;">
            <textarea id="notableInput" rows="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;font-family:inherit;">${escapeHtml(data.condition?.TireNotes || '')}</textarea>
            <div style="margin-top:6px;">
              <button data-action="save-notable" style="background:var(--green-dark, #28a745);color:#fff;border:none;padding:6px 16px;border-radius:8px;font-size:13px;cursor:pointer;">Save</button>
              <button data-action="cancel-notable" style="background:none;border:none;color:var(--text-2);padding:6px 10px;font-size:13px;cursor:pointer;">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tire Monitor Section -->
      <div style="margin-bottom:20px;">
        <h3 style="margin:0 0 8px;font-size:16px;">Tire Monitor</h3>
        ${renderTireMonitor(data.maintenance, unitId, unitType)}
      </div>

      <!-- Invoice History Section -->
      <div style="margin-bottom:20px;">
        <h3 style="margin:0 0 8px;font-size:16px;">Invoice History</h3>
        ${invoices.length ? `
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="border-bottom:2px solid #dee2e6;text-align:left;">
                  <th style="padding:8px 4px;">Date</th>
                  <th style="padding:8px 4px;">Type</th>
                  <th style="padding:8px 4px;">Cost</th>
                  <th style="padding:8px 4px;">PDF</th>
                </tr>
              </thead>
              <tbody>
                ${invoices.map(inv => `<tr style="border-bottom:1px solid #eee;">
                  <td style="padding:8px 4px;">${escapeHtml(inv.Date)}</td>
                  <td style="padding:8px 4px;">${escapeHtml(inv.Type)}</td>
                  <td style="padding:8px 4px;">${inv.Cost ? '$' + escapeHtml(inv.Cost) : '—'}</td>
                  <td style="padding:8px 4px;">${inv.PdfPath ? `<a href="#" data-action="view-pdf" data-pdf-path="${escapeHtml(inv.PdfPath)}" style="color:var(--green-dark);text-decoration:none;">View</a>` : '—'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <p style="color:var(--text-2);">No invoices recorded yet</p>
        `}
      </div>

      <div class="toast" id="toast"></div>
    </div>`;

  // ── Attach event listeners ────────────────────────────────────────────────
  container.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset?.action;
    if (!action) return;

    if (action === 'view-pdf') {
      e.preventDefault();
      const pdfPath = e.target.closest('[data-pdf-path]')?.dataset?.pdfPath;
      if (pdfPath) handleViewPdf(e.target, pdfPath);
    }

    if (action === 'save-mileage') {
      handleSaveMileage(container, unitId);
    }

    if (action === 'milestone-done') {
      const milestoneType = e.target.closest('[data-milestone-type]')?.dataset?.milestoneType;
      if (milestoneType) handleMilestoneDone(container, unitId, milestoneType, currentMiles, data);
    }

    if (action === 'edit-notable') {
      const form = container.querySelector('#notableForm');
      const text = container.querySelector('#notableText');
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (text) text.style.display = form.style.display === 'none' ? 'block' : 'none';
    }

    if (action === 'cancel-notable') {
      const form = container.querySelector('#notableForm');
      const text = container.querySelector('#notableText');
      if (form) form.style.display = 'none';
      if (text) text.style.display = 'block';
    }

    if (action === 'save-notable') {
      handleSaveNotable(container, unitId);
    }

    if (action === 'update-tire') {
      const pos = e.target.closest('[data-tire-pos]')?.dataset?.tirePos;
      if (pos) {
        const picker = container.querySelector('#tirePicker-' + pos);
        if (picker) picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
      }
    }

    if (action === 'cancel-tire-date') {
      const pos = e.target.closest('[data-tire-pos]')?.dataset?.tirePos;
      if (pos) {
        const picker = container.querySelector('#tirePicker-' + pos);
        if (picker) picker.style.display = 'none';
      }
    }

    if (action === 'save-tire-date') {
      const pos = e.target.closest('[data-tire-pos]')?.dataset?.tirePos;
      if (pos) handleSaveTireDate(container, unitId, pos);
    }
  });
}

// ── Action handlers ─────────────────────────────────────────────────────────

async function handleViewPdf(linkEl, pdfPath) {
  const original = linkEl.textContent;
  linkEl.textContent = 'Loading...';
  linkEl.style.pointerEvents = 'none';

  try {
    const token = await getValidToken();
    if (!token) throw new Error('Not authenticated');
    const encodedPath = pdfPath.split('/').map(encodeURIComponent).join('/');
    const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;
    const resp = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');

    // Clean up blob URL after a delay (browser keeps it open in the new tab)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (err) {
    console.error('PDF fetch failed:', err);
    alert('Could not open PDF: ' + err.message);
  } finally {
    linkEl.textContent = original;
    linkEl.style.pointerEvents = '';
  }
}

async function handleSaveMileage(container, unitId) {
  const miles = (container.querySelector('#editMiles')?.value || '').trim();
  if (!miles) return;
  try {
    await saveConditionUpdate(unitId, { CurrentMiles: miles }, state.token, state.fleet.conditionPath);
    showToast(container, 'Mileage updated', 'success');
    render(container, { id: unitId });
  } catch (err) {
    console.error('Mileage save failed:', err);
    showToast(container, 'Save failed: ' + err.message, 'error');
  }
}

// ── Tire Monitor helpers ──────────────────────────────────────────────────────

function renderTireMonitor(maintenance, unitId, unitType) {
  const type = (unitType || '').toLowerCase();
  const isTruck = type === 'truck' || type === 'trucks';
  const isTrailer = type === 'trailer' || type === 'trailers' || type === 'reefer' || type === 'reefers';

  // Trucks: steer + drive only. Trailers/reefers: trailer positions only.
  let groups;
  if (isTruck) {
    groups = [
      { label: 'Steer', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('steer')) },
      { label: 'Drive Outer', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('drive-outer')) },
      { label: 'Drive Inner', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('drive-inner')) },
    ];
  } else if (isTrailer) {
    groups = [
      { label: 'Axle', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('trailer')) },
    ];
  } else {
    // Unknown type — show all
    groups = [
      { label: 'Steer', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('steer')) },
      { label: 'Drive Outer', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('drive-outer')) },
      { label: 'Drive Inner', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('drive-inner')) },
      { label: 'Trailer', positions: TIRE_POSITIONS.filter(p => p.key.startsWith('trailer')) },
    ];
  }

  return groups.map(g => `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${escapeHtml(g.label)}</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
        ${g.positions.map(pos => {
          const rec = maintenance.find(r => r.Type === 'tire-' + pos.key);
          const dateStr = rec?.LastDoneDate || null;
          return `<div style="background:var(--bg-2, #f8f9fa);border-radius:12px;padding:12px 14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="font-size:13px;">${escapeHtml(pos.label)}</strong>
              <button data-action="update-tire" data-tire-pos="${pos.key}" style="background:none;border:1px solid #999;color:#666;padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;">Update</button>
            </div>
            <div style="font-size:12px;color:var(--text-2);margin-top:4px;">${dateStr ? 'Replaced: ' + escapeHtml(dateStr) : 'Not recorded'}</div>
            <div id="tirePicker-${pos.key}" style="display:none;margin-top:8px;">
              <input type="date" class="tire-date-input" data-tire-pos="${pos.key}" value="${new Date().toISOString().split('T')[0]}" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;">
              <div style="margin-top:6px;display:flex;gap:6px;">
                <button data-action="save-tire-date" data-tire-pos="${pos.key}" style="background:var(--green-dark, #28a745);color:#fff;border:none;padding:4px 12px;border-radius:8px;font-size:12px;cursor:pointer;">Save</button>
                <button data-action="cancel-tire-date" data-tire-pos="${pos.key}" style="background:none;border:none;color:var(--text-2);padding:4px 8px;font-size:12px;cursor:pointer;">Cancel</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

async function updateTireDate(tireType, dateStr, unitId, token, maintenancePath, csvOps = defaultCsvOps) {
  const { text, hash } = await csvOps.downloadCSV(maintenancePath, token);
  const rows = csvOps.parseCSV(text);

  const idx = rows.findIndex(r => r.UnitId === unitId && r.Type === tireType);
  if (idx >= 0) {
    rows[idx].LastDoneDate = dateStr;
  } else {
    rows.push({
      MaintId: Date.now().toString(36),
      UnitId: unitId,
      Type: tireType,
      IntervalDays: '',
      IntervalMiles: '',
      LastDoneDate: dateStr,
      LastDoneMiles: '',
      Notes: '',
    });
  }

  const newText = csvOps.serializeCSV(MAINTENANCE_HEADERS, rows);
  return await csvOps.writeCSVWithLock(maintenancePath, hash, newText, token);
}

async function handleMilestoneDone(container, unitId, milestoneType, currentMiles, data) {
  const today = new Date().toISOString().split('T')[0];
  const unit = state.fleet.units.find(u => u.UnitId === unitId);
  const milestones = getMilestonesForCategory(unit?.Type || 'Other');
  const milestone = milestones.find(m => m.type === milestoneType);
  const existing = data.maintenance.find(r => r.Type === milestoneType);

  try {
    if (existing) {
      await markDoneToday(existing.MaintId, currentMiles, state.token, state.fleet.maintenancePath);
    } else {
      const row = {
        MaintId: Date.now().toString(36),
        UnitId: unitId,
        Type: milestoneType,
        IntervalDays: '',
        IntervalMiles: String(milestone?.intervalMiles || ''),
        LastDoneDate: today,
        LastDoneMiles: String(currentMiles),
        Notes: '',
      };
      await appendMaintenanceRecord(row, state.token, state.fleet.maintenancePath, state.fleet.maintenanceHash);
    }
    showToast(container, 'Milestone recorded', 'success');
    render(container, { id: unitId });
  } catch (err) {
    console.error('Milestone done failed:', err);
    showToast(container, 'Update failed: ' + err.message, 'error');
  }
}

async function handleSaveTireDate(container, unitId, posKey) {
  const input = container.querySelector('.tire-date-input[data-tire-pos="' + posKey + '"]');
  const dateStr = input?.value || '';
  if (!dateStr) return;

  try {
    await updateTireDate('tire-' + posKey, dateStr, unitId, state.token, state.fleet.maintenancePath);
    showToast(container, 'Tire date updated', 'success');
    render(container, { id: unitId });
  } catch (err) {
    console.error('Tire date save failed:', err);
    showToast(container, 'Save failed: ' + err.message, 'error');
  }
}

async function handleSaveNotable(container, unitId) {
  const value = (container.querySelector('#notableInput')?.value || '').trim();
  try {
    await saveConditionUpdate(unitId, { TireNotes: value }, state.token, state.fleet.conditionPath);
    showToast(container, 'Notable mentions saved', 'success');
    render(container, { id: unitId });
  } catch (err) {
    console.error('Notable mentions save failed:', err);
    showToast(container, 'Save failed: ' + err.message, 'error');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(container, msg, type = '') {
  const t = container.querySelector('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 3500);
}

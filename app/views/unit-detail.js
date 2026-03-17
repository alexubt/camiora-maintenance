/**
 * Unit detail view — invoice history, PM schedule, condition tracking.
 * Native ES module. Follows upload.js patterns for event delegation and toast.
 */

import { state } from '../state.js';
import { downloadCSV, parseCSV, serializeCSV, writeCSVWithLock } from '../graph/csv.js';
import { isOverdue, getDueDate, getDueMiles } from '../maintenance/schedule.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAINTENANCE_HEADERS = ['MaintId', 'UnitId', 'Type', 'IntervalDays', 'IntervalMiles', 'LastDoneDate', 'LastDoneMiles', 'Notes'];
const CONDITION_HEADERS = ['UnitId', 'CurrentMiles', 'DotExpiry', 'TireNotes', 'LastUpdated'];

const PM_PRESETS = [
  'oil-change', 'tire-rotation', 'brake-inspection', 'dot-inspection',
  'pm-service', 'engine-repair', 'transmission', 'electrical', 'ac-service', 'other',
];

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

function renderUnitInfo(unitId) {
  const unit = state.fleet.units.find(u => u.UnitId === unitId);
  if (!unit) return '<p style="color:var(--text-2);font-size:13px;margin:0 0 20px;">Unit not found in roster</p>';

  const fields = [
    { label: 'Type', value: unit.Type },
    { label: 'Make / Model', value: [unit.Make, unit.Model].filter(Boolean).join(' ') || null },
    { label: 'Year', value: unit.Year },
    { label: 'VIN', value: unit.VIN },
    { label: 'Plate', value: unit.PlateNr },
    { label: 'DOT Expiry', value: unit.DotExpiry },
  ].filter(f => f.value);

  if (!fields.length) return '<p style="color:var(--text-2);font-size:13px;margin:0 0 20px;">No unit details available</p>';

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px 16px;background:var(--bg-2,#f8f9fa);border-radius:12px;padding:14px 16px;margin:8px 0 20px;">
      ${fields.map(f => `
        <div>
          <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(f.label)}</div>
          <div style="font-size:14px;font-weight:500;margin-top:2px;">${escapeHtml(f.value)}</div>
        </div>
      `).join('')}
    </div>`;
}

function renderUnitPage(container, unitId, data) {
  const today = new Date().toISOString().split('T')[0];
  const currentMiles = data.condition ? Number(data.condition.CurrentMiles) || 0 : 0;

  // Sort invoices by date descending
  const invoices = [...data.invoices].sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));

  container.innerHTML = `
    <div style="padding:16px;padding-bottom:80px;">
      <a href="#dashboard" style="color:var(--green-dark);text-decoration:none;font-size:14px;">&#8592; Back</a>
      <h2 style="margin:12px 0 4px;">${escapeHtml(unitId)}</h2>
      ${renderUnitInfo(unitId)}


      <!-- Condition Section -->
      <div style="background:var(--bg-2, #f8f9fa);border-radius:12px;padding:16px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:16px;">Condition</h3>
          <button data-action="edit-condition" style="background:none;border:1px solid var(--green-dark, #28a745);color:var(--green-dark, #28a745);padding:4px 12px;border-radius:8px;font-size:13px;cursor:pointer;">Edit</button>
        </div>
        ${data.condition ? `
          <div style="margin-top:12px;">
            <div style="margin-bottom:8px;"><strong>Mileage:</strong> ${escapeHtml(data.condition.CurrentMiles || '—')}</div>
            <div style="margin-bottom:8px;"><strong>DOT Expiry:</strong> ${escapeHtml(data.condition.DotExpiry || '—')} ${statusBadge(dotStatus(data.condition.DotExpiry, today), dotStatus(data.condition.DotExpiry, today))}</div>
            <div style="margin-bottom:8px;"><strong>Tire Notes:</strong> ${escapeHtml(data.condition.TireNotes || '—')}</div>
            <div style="font-size:12px;color:var(--text-2);">Last updated: ${escapeHtml(data.condition.LastUpdated || '—')}</div>
          </div>
        ` : `
          <p style="color:var(--text-2);margin:12px 0 0;">No condition data — tap Edit to add</p>
        `}
        <div id="conditionForm" style="display:none;margin-top:12px;">
          <div style="margin-bottom:8px;">
            <label style="display:block;font-size:13px;margin-bottom:4px;">Current Mileage</label>
            <input type="text" id="editMiles" inputmode="numeric" value="${escapeHtml(data.condition?.CurrentMiles || '')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"/>
          </div>
          <div style="margin-bottom:8px;">
            <label style="display:block;font-size:13px;margin-bottom:4px;">DOT Expiry</label>
            <input type="date" id="editDotExpiry" value="${escapeHtml(data.condition?.DotExpiry || '')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"/>
          </div>
          <div style="margin-bottom:8px;">
            <label style="display:block;font-size:13px;margin-bottom:4px;">Tire Notes</label>
            <input type="text" id="editTireNotes" value="${escapeHtml(data.condition?.TireNotes || '')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"/>
          </div>
          <button data-action="save-condition" style="background:var(--green-dark, #28a745);color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:14px;cursor:pointer;">Save</button>
          <button data-action="cancel-condition" style="background:none;border:none;color:var(--text-2);padding:8px 12px;font-size:14px;cursor:pointer;">Cancel</button>
        </div>
      </div>

      <!-- PM Schedule Section -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="margin:0;font-size:16px;">PM Schedule</h3>
          <button data-action="show-add-pm" style="background:none;border:1px solid var(--green-dark, #28a745);color:var(--green-dark, #28a745);padding:4px 12px;border-radius:8px;font-size:13px;cursor:pointer;">+ Add</button>
        </div>
        ${data.maintenance.length ? `
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="border-bottom:2px solid #dee2e6;text-align:left;">
                  <th style="padding:8px 4px;">Type</th>
                  <th style="padding:8px 4px;">Interval</th>
                  <th style="padding:8px 4px;">Last Done</th>
                  <th style="padding:8px 4px;">Due Date</th>
                  <th style="padding:8px 4px;">Status</th>
                  <th style="padding:8px 4px;"></th>
                </tr>
              </thead>
              <tbody>
                ${data.maintenance.map(rec => {
                  const dueDate = getDueDate(rec);
                  const dueMiles = getDueMiles(rec);
                  const overdue = isOverdue(rec, today, currentMiles);
                  const intervalParts = [];
                  if (rec.IntervalDays) intervalParts.push(`${rec.IntervalDays}d`);
                  if (rec.IntervalMiles) intervalParts.push(`${rec.IntervalMiles}mi`);
                  return `<tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 4px;">${escapeHtml(rec.Type)}</td>
                    <td style="padding:8px 4px;">${escapeHtml(intervalParts.join(' / ') || '—')}</td>
                    <td style="padding:8px 4px;">${escapeHtml(rec.LastDoneDate || '—')}</td>
                    <td style="padding:8px 4px;">${escapeHtml(dueDate || '—')}</td>
                    <td style="padding:8px 4px;">${overdue ? statusBadge('overdue', 'Overdue') : statusBadge('ok', 'OK')}</td>
                    <td style="padding:8px 4px;"><button data-action="mark-done" data-maint-id="${escapeHtml(rec.MaintId)}" style="background:none;border:1px solid #999;color:#666;padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;">Done</button></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <p style="color:var(--text-2);">No maintenance schedule configured yet</p>
        `}
        <div id="addPmForm" style="display:none;background:var(--bg-2, #f8f9fa);border-radius:12px;padding:16px;margin-top:12px;">
          <div style="margin-bottom:8px;">
            <label style="display:block;font-size:13px;margin-bottom:4px;">Type</label>
            <select id="pmType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;">
              ${PM_PRESETS.map(p => `<option value="${p}">${p}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <div style="flex:1;">
              <label style="display:block;font-size:13px;margin-bottom:4px;">Interval Days</label>
              <input type="text" id="pmIntervalDays" inputmode="numeric" placeholder="90" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"/>
            </div>
            <div style="flex:1;">
              <label style="display:block;font-size:13px;margin-bottom:4px;">Interval Miles</label>
              <input type="text" id="pmIntervalMiles" inputmode="numeric" placeholder="5000" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"/>
            </div>
          </div>
          <div style="margin-bottom:8px;">
            <label style="display:block;font-size:13px;margin-bottom:4px;">Notes</label>
            <input type="text" id="pmNotes" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"/>
          </div>
          <button data-action="save-pm" style="background:var(--green-dark, #28a745);color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:14px;cursor:pointer;">Save</button>
          <button data-action="cancel-pm" style="background:none;border:none;color:var(--text-2);padding:8px 12px;font-size:14px;cursor:pointer;">Cancel</button>
        </div>
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
                  <td style="padding:8px 4px;">${inv.PdfPath ? `<a href="https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(inv.PdfPath)}:/content" target="_blank" style="color:var(--green-dark);">View</a>` : '—'}</td>
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

    if (action === 'edit-condition') {
      const form = container.querySelector('#conditionForm');
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }

    if (action === 'cancel-condition') {
      const form = container.querySelector('#conditionForm');
      if (form) form.style.display = 'none';
    }

    if (action === 'save-condition') {
      handleSaveCondition(container, unitId);
    }

    if (action === 'show-add-pm') {
      const form = container.querySelector('#addPmForm');
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }

    if (action === 'cancel-pm') {
      const form = container.querySelector('#addPmForm');
      if (form) form.style.display = 'none';
    }

    if (action === 'save-pm') {
      handleSavePm(container, unitId);
    }

    if (action === 'mark-done') {
      const maintId = e.target.closest('[data-maint-id]')?.dataset?.maintId;
      if (maintId) handleMarkDone(container, unitId, maintId, currentMiles);
    }
  });
}

// ── Action handlers ─────────────────────────────────────────────────────────

async function handleSaveCondition(container, unitId) {
  const miles = (container.querySelector('#editMiles')?.value || '').trim();
  const dotExp = (container.querySelector('#editDotExpiry')?.value || '').trim();
  const tireNotes = (container.querySelector('#editTireNotes')?.value || '').trim();

  try {
    await saveConditionUpdate(unitId, {
      CurrentMiles: miles,
      DotExpiry: dotExp,
      TireNotes: tireNotes,
    }, state.token, state.fleet.conditionPath);
    showToast(container, 'Condition updated', 'success');
    // Re-render the page
    render(container, { id: unitId });
  } catch (err) {
    console.error('Condition save failed:', err);
    showToast(container, 'Save failed: ' + err.message, 'error');
  }
}

async function handleSavePm(container, unitId) {
  const type = container.querySelector('#pmType')?.value || '';
  const intervalDays = (container.querySelector('#pmIntervalDays')?.value || '').trim();
  const intervalMiles = (container.querySelector('#pmIntervalMiles')?.value || '').trim();
  const notes = (container.querySelector('#pmNotes')?.value || '').trim();
  const today = new Date().toISOString().split('T')[0];

  const row = {
    MaintId: Date.now().toString(36),
    UnitId: unitId,
    Type: type,
    IntervalDays: intervalDays,
    IntervalMiles: intervalMiles,
    LastDoneDate: today,
    LastDoneMiles: '',
    Notes: notes,
  };

  try {
    await appendMaintenanceRecord(row, state.token, state.fleet.maintenancePath, state.fleet.maintenanceHash);
    showToast(container, 'Schedule added', 'success');
    render(container, { id: unitId });
  } catch (err) {
    console.error('PM save failed:', err);
    showToast(container, 'Save failed: ' + err.message, 'error');
  }
}

async function handleMarkDone(container, unitId, maintId, currentMiles) {
  try {
    await markDoneToday(maintId, currentMiles, state.token, state.fleet.maintenancePath);
    showToast(container, 'Marked as done', 'success');
    render(container, { id: unitId });
  } catch (err) {
    console.error('Mark done failed:', err);
    showToast(container, 'Update failed: ' + err.message, 'error');
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

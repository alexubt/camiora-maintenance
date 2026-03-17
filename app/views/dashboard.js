/**
 * Dashboard view — action-focused overview with overdue/due-soon alerts and fleet unit cards.
 * Native ES module. Follows unit-detail.js patterns for data loading and rendering.
 */

import { state } from '../state.js';
import { downloadCSV, parseCSV } from '../graph/csv.js';
import { isOverdue, getDueDate, getDueMiles } from '../maintenance/schedule.js';
import { appendUnit } from '../fleet/units.js';
import { getValidToken } from '../graph/auth.js';
import { refreshUnitSelect } from './upload.js';
import { setCachedFleet } from '../storage/cache.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape HTML entities for safe innerHTML use. */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Compute day difference: positive = days until, negative = days past. */
function dayDiff(dateA, dateB) {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/** Status badge as inline HTML span. */
function statusBadge(status, label) {
  const colors = {
    overdue:   'background:#dc3545;color:#fff',
    'due-soon': 'background:#ffc107;color:#333',
    ok:        'background:#28a745;color:#fff',
  };
  const style = colors[status] || colors.ok;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;${style}">${escapeHtml(label)}</span>`;
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadDashboardData(token) {
  const [maintResult, condResult] = await Promise.allSettled([
    downloadCSV(state.fleet.maintenancePath, token),
    downloadCSV(state.fleet.conditionPath, token),
  ]);

  const maintData = maintResult.status === 'fulfilled' ? maintResult.value : { text: null, hash: null };
  const condData  = condResult.status === 'fulfilled' ? condResult.value : { text: null, hash: null };

  const allMaintenance = parseCSV(maintData.text);
  const allCondition   = parseCSV(condData.text);

  return { allMaintenance, allCondition };
}

// ── Render ───────────────────────────────────────────────────────────────────

export function render(container, params = {}) {
  if (!state.token) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="color:var(--text-2);">Please sign in to view the dashboard.</p>
        <a href="#upload" style="color:var(--green-dark);">Sign in</a>
      </div>`;
    return;
  }

  // Loading skeleton
  container.innerHTML = `
    <div style="padding:16px;">
      <h2 style="margin:0 0 16px;">Dashboard</h2>
      <div style="color:var(--text-2);padding:40px 0;text-align:center;">Loading fleet data...</div>
    </div>`;

  loadDashboardData(state.token).then(({ allMaintenance, allCondition }) => {
    renderDashboard(container, allMaintenance, allCondition);
  }).catch(err => {
    console.error('Dashboard data load failed:', err);
    container.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="color:#dc3545;">Failed to load data: ${escapeHtml(err.message)}</p>
        <a href="#upload" style="color:var(--green-dark);">Back</a>
      </div>`;
  });
}

function renderDashboard(container, allMaintenance, allCondition) {
  const today = new Date().toISOString().split('T')[0];
  const units = state.fleet.units;

  // Build a map of condition per unit
  const conditionMap = {};
  for (const c of allCondition) {
    if (c.UnitId) conditionMap[c.UnitId] = c;
  }

  // Classify each maintenance record
  const overdueItems = [];
  const dueSoonItems = [];
  const unitStatusMap = {}; // unitId => 'overdue' | 'due-soon' | 'ok'

  for (const rec of allMaintenance) {
    const unitId = rec.UnitId;
    if (!unitId) continue;
    const cond = conditionMap[unitId];
    const currentMiles = cond ? Number(cond.CurrentMiles) || 0 : 0;

    if (isOverdue(rec, today, currentMiles)) {
      overdueItems.push(buildActionItem(rec, unitId, today, currentMiles, 'overdue'));
      unitStatusMap[unitId] = 'overdue';
    } else {
      // Check "due soon": within 7 days or 500 miles
      const dueDate = getDueDate(rec);
      const dueMiles = getDueMiles(rec);
      let dueSoon = false;

      if (dueDate !== null) {
        const daysUntil = dayDiff(dueDate, today);
        if (daysUntil >= 0 && daysUntil <= 7) dueSoon = true;
      }
      if (dueMiles !== null && currentMiles > 0) {
        const milesUntil = dueMiles - currentMiles;
        if (milesUntil >= 0 && milesUntil <= 500) dueSoon = true;
      }

      if (dueSoon) {
        dueSoonItems.push(buildActionItem(rec, unitId, today, currentMiles, 'due-soon'));
        if (unitStatusMap[unitId] !== 'overdue') {
          unitStatusMap[unitId] = 'due-soon';
        }
      }
    }
  }

  // Ensure all units have a status entry
  for (const u of units) {
    if (!unitStatusMap[u.UnitId]) unitStatusMap[u.UnitId] = 'ok';
  }

  // Sort units: overdue first, then due-soon, then ok
  const statusOrder = { overdue: 0, 'due-soon': 1, ok: 2 };
  const sortedUnits = [...units].sort((a, b) => {
    const sa = statusOrder[unitStatusMap[a.UnitId] || 'ok'] ?? 2;
    const sb = statusOrder[unitStatusMap[b.UnitId] || 'ok'] ?? 2;
    return sa - sb;
  });

  // Build action items HTML
  let actionHtml = '';
  if (overdueItems.length === 0 && dueSoonItems.length === 0) {
    actionHtml = `
      <div style="background:rgba(40,167,69,0.08);border-left:3px solid #28a745;padding:12px 14px;border-radius:var(--radius);margin-bottom:8px;color:#28a745;font-weight:500;">
        All caught up — no maintenance items need attention.
      </div>`;
  } else {
    for (const item of overdueItems) {
      actionHtml += renderActionItem(item, 'overdue');
    }
    for (const item of dueSoonItems) {
      actionHtml += renderActionItem(item, 'due-soon');
    }
  }

  // Build unit cards HTML
  let cardsHtml = '';
  for (const u of sortedUnits) {
    const st = unitStatusMap[u.UnitId] || 'ok';
    const badgeLabel = st === 'overdue' ? 'Overdue' : st === 'due-soon' ? 'Due Soon' : 'OK';
    cardsHtml += `
      <a href="#unit?id=${encodeURIComponent(u.UnitId)}" class="dash-card">
        <div>
          <div style="font-weight:600;font-size:15px;">${escapeHtml(u.UnitId)}</div>
          <div style="font-size:13px;color:var(--text-2);margin-top:2px;">${escapeHtml(u.Type || '')}</div>
        </div>
        ${statusBadge(st, badgeLabel)}
      </a>`;
  }

  const emptyStateHtml = `
    <div style="text-align:center;padding:24px 0;">
      <p style="color:var(--text-2);margin:0 0 12px;">Your roster is empty. Add your first unit to get started.</p>
      <div id="addUnitForm">
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <input id="newUnitId" type="text" placeholder="Unit ID (e.g. TR-042)" maxlength="30"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;width:160px;">
          <select id="newUnitType" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;">
            <option value="Truck">Truck</option>
            <option value="Trailer">Trailer</option>
            <option value="Van">Van</option>
            <option value="Reefer">Reefer</option>
            <option value="Other">Other</option>
          </select>
          <button id="addUnitBtn" style="padding:8px 16px;background:var(--green-dark);color:#fff;border:none;border-radius:var(--radius);font-size:14px;cursor:pointer;">Add Unit</button>
        </div>
        <p id="addUnitError" style="color:#dc3545;font-size:13px;margin:8px 0 0;display:none;"></p>
      </div>
    </div>`;

  const addUnitBtnHtml = `
    <div style="margin-top:12px;text-align:center;">
      <button id="showAddUnitBtn" style="padding:6px 14px;background:transparent;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;cursor:pointer;color:var(--text-2);">+ Add unit</button>
      <div id="addUnitForm" style="display:none;margin-top:10px;">
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <input id="newUnitId" type="text" placeholder="Unit ID (e.g. TR-042)" maxlength="30"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;width:160px;">
          <select id="newUnitType" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;">
            <option value="Truck">Truck</option>
            <option value="Trailer">Trailer</option>
            <option value="Van">Van</option>
            <option value="Reefer">Reefer</option>
            <option value="Other">Other</option>
          </select>
          <button id="addUnitBtn" style="padding:8px 16px;background:var(--green-dark);color:#fff;border:none;border-radius:var(--radius);font-size:14px;cursor:pointer;">Add Unit</button>
        </div>
        <p id="addUnitError" style="color:#dc3545;font-size:13px;margin:8px 0 0;display:none;"></p>
      </div>
    </div>`;

  container.innerHTML = `
    <div style="padding:16px;padding-bottom:80px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 16px;">
        <h2 style="margin:0;">Dashboard</h2>
        <a href="#upload" style="color:var(--green-dark);text-decoration:none;font-size:14px;font-weight:500;">Upload &rarr;</a>
      </div>

      ${actionHtml}

      <div style="margin-top:20px;">
        <h3 style="margin:0 0 10px;font-size:16px;">Fleet <span style="color:var(--text-2);font-weight:400;font-size:14px;">(${units.length})</span></h3>
        <div class="dash-grid">
          ${cardsHtml || emptyStateHtml}
        </div>
        ${cardsHtml ? addUnitBtnHtml : ''}
      </div>
    </div>`;

  // Wire up "Add unit" interactions
  const showBtn = document.getElementById('showAddUnitBtn');
  if (showBtn) {
    showBtn.addEventListener('click', () => {
      showBtn.style.display = 'none';
      document.getElementById('addUnitForm').style.display = '';
      document.getElementById('newUnitId').focus();
    });
  }

  const addBtn = document.getElementById('addUnitBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => handleAddUnit(container, allMaintenance, allCondition));
  }

  // Allow Enter key to submit
  const unitInput = document.getElementById('newUnitId');
  if (unitInput) {
    unitInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddUnit(container, allMaintenance, allCondition);
    });
  }
}

async function handleAddUnit(container, allMaintenance, allCondition) {
  const idInput = document.getElementById('newUnitId');
  const typeSelect = document.getElementById('newUnitType');
  const errEl = document.getElementById('addUnitError');
  const addBtn = document.getElementById('addUnitBtn');

  const unitId = (idInput.value || '').trim();
  if (!unitId) {
    errEl.textContent = 'Unit ID is required.';
    errEl.style.display = '';
    idInput.focus();
    return;
  }

  // Check for duplicate
  if (state.fleet.units.some(u => u.UnitId === unitId)) {
    errEl.textContent = `Unit "${unitId}" already exists.`;
    errEl.style.display = '';
    idInput.focus();
    return;
  }

  errEl.style.display = 'none';
  addBtn.disabled = true;
  addBtn.textContent = 'Adding...';

  const row = { UnitId: unitId, Type: typeSelect.value };

  try {
    const token = await getValidToken();
    await appendUnit(row, token, state.fleet.unitsPath);
    state.fleet.units.push(row);
    // Update hash so future writes have correct baseline
    const { downloadCSV: dl, parseCSV: ps } = await import('../graph/csv.js');
    const { hash } = await dl(state.fleet.unitsPath, token);
    state.fleet.unitsHash = hash;
    // Update cache
    setCachedFleet({ units: state.fleet.units, hash }).catch(() => {});
    // Refresh upload view dropdown
    refreshUnitSelect();
    // Re-render dashboard with updated data
    renderDashboard(container, allMaintenance, allCondition);
  } catch (err) {
    errEl.textContent = `Failed to add unit: ${err.message}`;
    errEl.style.display = '';
    addBtn.disabled = false;
    addBtn.textContent = 'Add Unit';
  }
}

// ── Action item builders ─────────────────────────────────────────────────────

function buildActionItem(rec, unitId, today, currentMiles, status) {
  const dueDate = getDueDate(rec);
  const dueMiles = getDueMiles(rec);

  let detail = '';
  if (status === 'overdue') {
    if (dueDate !== null && today > dueDate) {
      const days = dayDiff(today, dueDate);
      detail = `${days} day${days !== 1 ? 's' : ''} past due`;
    }
    if (dueMiles !== null && currentMiles >= dueMiles) {
      const miles = currentMiles - dueMiles;
      if (detail) detail += ' / ';
      detail += `${miles} mi past due`;
    }
  } else {
    if (dueDate !== null) {
      const days = dayDiff(dueDate, today);
      if (days >= 0 && days <= 7) {
        detail = `due in ${days} day${days !== 1 ? 's' : ''}`;
      }
    }
    if (dueMiles !== null && currentMiles > 0) {
      const miles = dueMiles - currentMiles;
      if (miles >= 0 && miles <= 500) {
        if (detail) detail += ' / ';
        detail += `${miles} mi remaining`;
      }
    }
  }

  return { unitId, type: rec.Type || 'maintenance', detail };
}

function renderActionItem(item, status) {
  const cls = status === 'overdue' ? 'dash-action-overdue' : 'dash-action-due-soon';
  return `
    <a href="#unit?id=${encodeURIComponent(item.unitId)}" class="dash-action ${cls}">
      <div>
        <div style="font-weight:600;font-size:14px;">${escapeHtml(item.unitId)} — ${escapeHtml(item.type)}</div>
        <div style="font-size:12px;color:var(--text-2);margin-top:2px;">${escapeHtml(item.detail)}</div>
      </div>
    </a>`;
}

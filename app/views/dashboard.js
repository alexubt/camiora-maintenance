/**
 * Dashboard view — category tabs, action alerts, unit cards with milestone summaries.
 * Native ES module.
 */

import { state } from '../state.js';
import { downloadCSV, parseCSV } from '../graph/csv.js';
import { isOverdue, getDueDate, getDueMiles } from '../maintenance/schedule.js';
import { getMilestonesForCategory, getMilestoneStatus } from '../maintenance/milestones.js';
import { appendUnit } from '../fleet/units.js';
import { getValidToken } from '../graph/auth.js';
import { refreshUnitSelect } from './upload.js';
import { setCachedFleet } from '../storage/cache.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dayDiff(dateA, dateB) {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function statusBadge(status, label) {
  return `<span class="status-badge status-badge--${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function formatMiles(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString() + ' mi';
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadDashboardData(token) {
  const [maintResult, condResult] = await Promise.allSettled([
    downloadCSV(state.fleet.maintenancePath, token),
    downloadCSV(state.fleet.conditionPath, token),
  ]);

  const maintData = maintResult.status === 'fulfilled' ? maintResult.value : { text: null };
  const condData = condResult.status === 'fulfilled' ? condResult.value : { text: null };

  return {
    allMaintenance: parseCSV(maintData.text),
    allCondition: parseCSV(condData.text),
  };
}

// ── Render entry point ──────────────────────────────────────────────────────

export function render(container) {
  if (!state.token) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="color:var(--text-2);">Please sign in to view the dashboard.</p>
        <a href="#upload" style="color:var(--green-dark);">Sign in</a>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="header">
      <div class="logo-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M3 17L8 7H16L21 17" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="5.5" cy="18.5" r="2" fill="white"/>
          <circle cx="18.5" cy="18.5" r="2" fill="white"/>
        </svg>
      </div>
      <div style="flex:1;">
        <div class="logo-text">Camiora</div>
        <div class="logo-sub">Dashboard</div>
      </div>
    </div>
    <nav class="section-nav">
      <a href="#upload" class="section-nav-tab">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Upload
      </a>
      <a href="#dashboard" class="section-nav-tab active">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
        </svg>
        Dashboard
      </a>
    </nav>
    <div style="padding:16px;">
      <div class="skeleton skeleton-bar"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>`;

  loadDashboardData(state.token).then(({ allMaintenance, allCondition }) => {
    renderDashboard(container, allMaintenance, allCondition);
  }).catch(err => {
    console.error('Dashboard load failed:', err);
    container.innerHTML += `<div style="padding:24px;text-align:center;color:#dc3545;">Failed to load: ${escapeHtml(err.message)}</div>`;
  });
}

// ── Main dashboard renderer ─────────────────────────────────────────────────

let _activeTab = null; // persist tab selection across re-renders

function renderDashboard(container, allMaintenance, allCondition) {
  const today = new Date().toISOString().split('T')[0];
  const units = state.fleet.units;

  // Build condition map
  const conditionMap = {};
  for (const c of allCondition) if (c.UnitId) conditionMap[c.UnitId] = c;

  // Build maintenance map per unit
  const maintMap = {};
  for (const r of allMaintenance) {
    if (!r.UnitId) continue;
    (maintMap[r.UnitId] = maintMap[r.UnitId] || []).push(r);
  }

  // Discover categories from units (preserve order of first appearance)
  const categories = [];
  const categorySet = new Set();
  for (const u of units) {
    const cat = (u.Type || 'Other').trim();
    if (!categorySet.has(cat)) {
      categorySet.add(cat);
      categories.push(cat);
    }
  }

  // Default to first category or persisted tab
  if (!_activeTab || !categorySet.has(_activeTab)) {
    _activeTab = categories[0] || 'All';
  }

  // Build overdue/due-soon action items (across all categories)
  // Also count overdue items per unit for card badges
  const overdueItems = [];
  const dueSoonItems = [];
  const unitStatusMap = {};
  const unitOverdueCount = {}; // unitId → number of overdue records

  for (const rec of allMaintenance) {
    const unitId = rec.UnitId;
    if (!unitId) continue;
    const cond = conditionMap[unitId];
    const currentMiles = cond ? Number(cond.CurrentMiles) || 0 : 0;

    if (isOverdue(rec, today, currentMiles)) {
      overdueItems.push(buildActionItem(rec, unitId, today, currentMiles, 'overdue'));
      unitStatusMap[unitId] = 'overdue';
      unitOverdueCount[unitId] = (unitOverdueCount[unitId] || 0) + 1;
    } else {
      const dueDate = getDueDate(rec);
      const dueMiles = getDueMiles(rec);
      let dueSoon = false;
      if (dueDate !== null && dayDiff(dueDate, today) >= 0 && dayDiff(dueDate, today) <= 7) dueSoon = true;
      if (dueMiles !== null && currentMiles > 0 && (dueMiles - currentMiles) >= 0 && (dueMiles - currentMiles) <= 500) dueSoon = true;
      if (dueSoon) {
        dueSoonItems.push(buildActionItem(rec, unitId, today, currentMiles, 'due-soon'));
        if (unitStatusMap[unitId] !== 'overdue') unitStatusMap[unitId] = 'due-soon';
      }
    }
  }

  for (const u of units) {
    if (!unitStatusMap[u.UnitId]) unitStatusMap[u.UnitId] = 'ok';
  }

  // Action items HTML
  let actionHtml = '';
  if (overdueItems.length === 0 && dueSoonItems.length === 0) {
    actionHtml = `
      <div style="background:rgba(40,167,69,0.08);border-left:3px solid #28a745;padding:12px 14px;border-radius:var(--radius);margin-bottom:8px;color:#28a745;font-weight:500;">
        All caught up — no maintenance items need attention.
      </div>`;
  } else {
    for (const item of overdueItems) actionHtml += renderActionItem(item, 'overdue');
    for (const item of dueSoonItems) actionHtml += renderActionItem(item, 'due-soon');
  }

  // Category tabs HTML
  const tabsHtml = categories.map(cat => {
    const count = units.filter(u => (u.Type || 'Other').trim() === cat).length;
    const active = cat === _activeTab ? ' dash-tab-active' : '';
    return `<button class="dash-tab${active}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}s <span style="opacity:0.6;font-size:12px;">(${count})</span></button>`;
  }).join('');

  // Filter units for active tab
  const tabUnits = units.filter(u => (u.Type || 'Other').trim() === _activeTab);

  // Sort: overdue first, then due-soon, then ok
  const statusOrder = { overdue: 0, 'due-soon': 1, ok: 2 };
  tabUnits.sort((a, b) => (statusOrder[unitStatusMap[a.UnitId] || 'ok'] ?? 2) - (statusOrder[unitStatusMap[b.UnitId] || 'ok'] ?? 2));

  // Unit cards with milestone summaries
  const cardsHtml = tabUnits.map(u => {
    const st = unitStatusMap[u.UnitId] || 'ok';
    const cond = conditionMap[u.UnitId];
    const currentMiles = cond ? Number(cond.CurrentMiles) || 0 : 0;
    const unitMaint = maintMap[u.UnitId] || [];
    const milestones = getMilestonesForCategory(u.Type || 'Other');

    // Build milestone rows
    const msRows = milestones.map(ms => {
      const s = getMilestoneStatus(ms, unitMaint, currentMiles);
      const statusCls = s.status === 'overdue' ? 'milestone-status--overdue'
        : s.status === 'ok' ? 'milestone-status--ok' : 'milestone-status--na';
      const icon = s.status === 'overdue' ? '!' : s.status === 'ok' ? '&#10003;' : '—';
      let info = '';
      if (s.nextDueMiles != null) {
        info = `@ ${Math.round(s.nextDueMiles / 1000)}K`;
        if (s.status === 'overdue') info += ' (overdue)';
      } else if (s.status === 'no-interval') {
        info = s.lastDoneMiles != null ? `done @ ${Math.round(s.lastDoneMiles / 1000)}K` : 'no interval';
      } else {
        info = 'not tracked';
      }
      return `<div style="display:flex;align-items:center;gap:4px;font-size:12px;line-height:1.6;">
        <span class="milestone-status ${statusCls}">${icon}</span>
        <span style="flex:1;color:var(--text);">${escapeHtml(ms.label)}</span>
        <span style="color:var(--text-2);font-variant-numeric:tabular-nums;">${info}</span>
      </div>`;
    }).join('');

    // Badge uses the unified overdue count from isOverdue() — consistent with action banners
    const overdueCount = unitOverdueCount[u.UnitId] || 0;
    const badgeLabel = overdueCount > 0 ? `${overdueCount} Overdue` : st === 'due-soon' ? 'Due Soon' : 'OK';
    const badgeStatus = overdueCount > 0 ? 'overdue' : st;

    return `
      <a href="#unit?id=${encodeURIComponent(u.UnitId)}" class="dash-card-expanded">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div>
            <div style="font-weight:600;font-size:15px;">${escapeHtml(u.UnitId)}</div>
            <div style="font-size:12px;color:var(--text-2);">${escapeHtml(u.Type || '')}${currentMiles ? ' · ' + formatMiles(currentMiles) : ''}</div>
          </div>
          ${statusBadge(badgeStatus, badgeLabel)}
        </div>
        <div style="border-top:1px solid var(--border, #eee);padding-top:6px;">
          ${msRows}
        </div>
      </a>`;
  }).join('');

  // Empty state
  const emptyHtml = !tabUnits.length ? `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 17L8 7H16L21 17" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>
      </svg>
      <p>No ${_activeTab ? _activeTab.toLowerCase() + 's' : 'units'} in the fleet yet.</p>
      <button class="empty-state-cta" id="emptyAddUnitBtn">Add your first ${_activeTab ? _activeTab.toLowerCase() : 'unit'}</button>
    </div>` : '';

  // Add unit form
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
    <div class="header">
      <div class="logo-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M3 17L8 7H16L21 17" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="5.5" cy="18.5" r="2" fill="white"/>
          <circle cx="18.5" cy="18.5" r="2" fill="white"/>
        </svg>
      </div>
      <div style="flex:1;">
        <div class="logo-text">Camiora</div>
        <div class="logo-sub">Dashboard</div>
      </div>
    </div>

    <nav class="section-nav">
      <a href="#upload" class="section-nav-tab">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Upload
      </a>
      <a href="#dashboard" class="section-nav-tab active">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
        </svg>
        Dashboard
      </a>
    </nav>

    <div style="padding:16px;padding-bottom:80px;">
      ${actionHtml}

      ${categories.length > 1 ? `
        <div class="dash-tabs" style="display:flex;gap:6px;margin:16px 0 12px;overflow-x:auto;-webkit-overflow-scrolling:touch;">
          ${tabsHtml}
        </div>
      ` : '<div style="margin-top:16px;"></div>'}

      <div class="dash-grid-expanded">
        ${cardsHtml || emptyHtml}
      </div>
      ${addUnitBtnHtml}
    </div>`;

  // Wire tab clicks
  container.querySelectorAll('.dash-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.category;
      renderDashboard(container, allMaintenance, allCondition);
    });
  });

  // Wire add unit
  const showBtn = document.getElementById('showAddUnitBtn');
  if (showBtn) {
    showBtn.addEventListener('click', () => {
      showBtn.style.display = 'none';
      document.getElementById('addUnitForm').style.display = '';
      document.getElementById('newUnitId').focus();
    });
  }

  const emptyAddBtn = document.getElementById('emptyAddUnitBtn');
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener('click', () => {
      if (showBtn) showBtn.style.display = 'none';
      document.getElementById('addUnitForm').style.display = '';
      document.getElementById('newUnitId').focus();
    });
  }

  const addBtn = document.getElementById('addUnitBtn');
  if (addBtn) addBtn.addEventListener('click', () => handleAddUnit(container, allMaintenance, allCondition));

  const unitInput = document.getElementById('newUnitId');
  if (unitInput) unitInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleAddUnit(container, allMaintenance, allCondition); });
}

// ── Add unit handler ────────────────────────────────────────────────────────

async function handleAddUnit(container, allMaintenance, allCondition) {
  const idInput = document.getElementById('newUnitId');
  const typeSelect = document.getElementById('newUnitType');
  const errEl = document.getElementById('addUnitError');
  const addBtn = document.getElementById('addUnitBtn');

  const unitId = (idInput.value || '').trim();
  if (!unitId) { errEl.textContent = 'Unit ID is required.'; errEl.style.display = ''; idInput.focus(); return; }
  if (state.fleet.units.some(u => u.UnitId === unitId)) { errEl.textContent = `Unit "${unitId}" already exists.`; errEl.style.display = ''; return; }

  errEl.style.display = 'none';
  addBtn.disabled = true;
  addBtn.textContent = 'Adding...';

  const row = { UnitId: unitId, Type: typeSelect.value };

  try {
    const token = await getValidToken();
    await appendUnit(row, token, state.fleet.unitsPath);
    state.fleet.units.push(row);
    const { hash } = await downloadCSV(state.fleet.unitsPath, token);
    state.fleet.unitsHash = hash;
    setCachedFleet({ units: state.fleet.units, hash }).catch(() => {});
    refreshUnitSelect();
    _activeTab = typeSelect.value; // switch to the new unit's tab
    renderDashboard(container, allMaintenance, allCondition);
  } catch (err) {
    errEl.textContent = `Failed: ${err.message}`;
    errEl.style.display = '';
    addBtn.disabled = false;
    addBtn.textContent = 'Add Unit';
  }
}

// ── Action item builders ────────────────────────────────────────────────────

function buildActionItem(rec, unitId, today, currentMiles, status) {
  const dueDate = getDueDate(rec);
  const dueMiles = getDueMiles(rec);
  let detail = '';

  if (status === 'overdue') {
    if (dueDate !== null && today > dueDate) { const d = dayDiff(today, dueDate); detail = `${d} day${d !== 1 ? 's' : ''} past due`; }
    if (dueMiles !== null && currentMiles >= dueMiles) { if (detail) detail += ' / '; detail += `${currentMiles - dueMiles} mi past due`; }
  } else {
    if (dueDate !== null) { const d = dayDiff(dueDate, today); if (d >= 0 && d <= 7) detail = `due in ${d} day${d !== 1 ? 's' : ''}`; }
    if (dueMiles !== null && currentMiles > 0) { const m = dueMiles - currentMiles; if (m >= 0 && m <= 500) { if (detail) detail += ' / '; detail += `${m} mi remaining`; } }
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

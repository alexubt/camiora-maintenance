/**
 * Dashboard view — category tabs, action alerts, unit cards with milestone summaries.
 * Native ES module.
 */

import { state } from '../state.js';
import { downloadCSV, parseCSV } from '../graph/csv.js';
import { getMilestonesForCategory, getMilestoneStatus } from '../maintenance/milestones.js';
import { appendUnit } from '../fleet/units.js';
import { saveConditionUpdate } from './unit-detail.js';
import { getValidToken } from '../graph/auth.js';
import { refreshUnitSelect } from './upload.js';
import { setCachedFleet } from '../storage/cache.js';

// ── Samsara sync badge ──────────────────────────────────────────────────────

function renderSamsaraBadge() {
  const s = state.samsara;
  if (!s || s.syncStatus === 'idle' || s.syncStatus === 'no-mapping') return '';

  let dot, label;
  if (s.syncStatus === 'syncing') {
    dot = 'background:#f59e0b;animation:pulse 1s infinite;';
    label = 'Syncing...';
  } else if (s.syncStatus === 'ok') {
    dot = 'background:#22c55e;';
    const ago = s.lastSynced ? Math.round((Date.now() - s.lastSynced) / 60000) : 0;
    label = ago < 1 ? 'Synced just now' : `Synced ${ago}m ago`;
  } else {
    dot = 'background:#ef4444;';
    label = 'Sync error';
  }

  return `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-2);margin-top:2px;">
    <span style="width:7px;height:7px;border-radius:50%;display:inline-block;${dot}"></span>
    ${escapeHtml(label)}
  </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
let _searchQuery = '';  // persist search across re-renders
let _statusFilter = 'all'; // persist status filter across re-renders

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

  // Build overdue counts using milestone system (same as card rows)
  let overdueCount = 0;
  let dueSoonCount = 0;
  const unitStatusMap = {};
  const unitOverdueCount = {}; // unitId → number of overdue milestones

  for (const u of units) {
    const cond = conditionMap[u.UnitId];
    const currentMiles = cond ? Number(cond.CurrentMiles) || 0 : 0;
    const unitMaint = allMaintenance.filter(r => r.UnitId === u.UnitId);
    const milestones = getMilestonesForCategory(u.Type || 'Other');

    let unitOverdue = 0;
    let unitDueSoon = false;
    for (const ms of milestones) {
      const s = getMilestoneStatus(ms, unitMaint, currentMiles);
      if (s.status === 'overdue') {
        unitOverdue++;
        overdueCount++;
      } else if (s.status === 'ok' && s.nextDueMiles != null && currentMiles > 0) {
        const remaining = s.nextDueMiles - currentMiles;
        if (remaining >= 0 && remaining <= 500) { dueSoonCount++; unitDueSoon = true; }
      }
    }

    unitOverdueCount[u.UnitId] = unitOverdue;
    if (unitOverdue > 0) unitStatusMap[u.UnitId] = 'overdue';
    else if (unitDueSoon) unitStatusMap[u.UnitId] = 'due-soon';
    else unitStatusMap[u.UnitId] = 'ok';
  }

  // Action banners removed — card badges + summary bar are sufficient

  // Fleet summary bar HTML (B4 — uses unfiltered counts across all categories)
  const summaryBarHtml = `
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="flex:1;background:var(--bg-2);border-radius:var(--radius);padding:10px 14px;text-align:center;">
        <div style="font-size:20px;font-weight:700;">${units.length}</div>
        <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;">Units</div>
      </div>
      <div style="flex:1;background:var(--bg-2);border-radius:var(--radius);padding:10px 14px;text-align:center;">
        <div class="milestone-status milestone-status--overdue" style="font-size:20px;font-weight:700;">${overdueCount}</div>
        <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;">Overdue</div>
      </div>
      <div style="flex:1;background:var(--bg-2);border-radius:var(--radius);padding:10px 14px;text-align:center;">
        <div style="font-size:20px;font-weight:700;color:var(--text-2);">${dueSoonCount}</div>
        <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;">Due Soon</div>
      </div>
    </div>`;

  // Search and status filter HTML (B6)
  const searchFilterHtml = `
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <input type="text" id="dashSearch" placeholder="Search by Unit ID..." value="${escapeHtml(_searchQuery)}"
        style="flex:1;min-width:0;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
      <select id="dashStatusFilter" style="width:90px;flex-shrink:0;height:40px;padding:0 6px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;background:var(--bg);color:var(--text);">
        <option value="all"${_statusFilter === 'all' ? ' selected' : ''}>All</option>
        <option value="overdue"${_statusFilter === 'overdue' ? ' selected' : ''}>Overdue</option>
        <option value="due-soon"${_statusFilter === 'due-soon' ? ' selected' : ''}>Due Soon</option>
        <option value="ok"${_statusFilter === 'ok' ? ' selected' : ''}>OK</option>
      </select>
    </div>`;

  // Category tabs HTML
  const tabsHtml = categories.map(cat => {
    const count = units.filter(u => (u.Type || 'Other').trim() === cat).length;
    const active = cat === _activeTab ? ' dash-tab-active' : '';
    return `<button class="dash-tab${active}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}s <span style="opacity:0.6;font-size:12px;">(${count})</span></button>`;
  }).join('');

  // Filter units for active tab
  const tabUnits = units.filter(u => (u.Type || 'Other').trim() === _activeTab);

  // Apply search and status filters (B6)
  let filteredUnits = tabUnits;
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filteredUnits = filteredUnits.filter(u => u.UnitId.toLowerCase().includes(q));
  }
  if (_statusFilter !== 'all') {
    filteredUnits = filteredUnits.filter(u => (unitStatusMap[u.UnitId] || 'ok') === _statusFilter);
  }

  // Sort: overdue first, then due-soon, then ok
  const statusOrder = { overdue: 0, 'due-soon': 1, ok: 2 };
  filteredUnits.sort((a, b) => (statusOrder[unitStatusMap[a.UnitId] || 'ok'] ?? 2) - (statusOrder[unitStatusMap[b.UnitId] || 'ok'] ?? 2));

  // Unit cards with milestone summaries
  const cardsHtml = filteredUnits.map(u => {
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

    // Badge uses milestone-based overdue count — consistent with card milestone rows
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
        <div style="border-top:1px solid var(--border);padding-top:6px;">
          ${msRows}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:6px;margin-top:6px;" onclick="event.preventDefault();event.stopPropagation();">
          <div style="display:flex;align-items:center;gap:6px;">
            <input type="text" inputmode="numeric" placeholder="${currentMiles ? currentMiles.toLocaleString() : 'Miles'}"
              data-mileage-unit="${escapeHtml(u.UnitId)}"
              style="flex:1;height:32px;padding:0 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:var(--bg);color:var(--text);">
            <button data-action="quick-mileage" data-unit-id="${escapeHtml(u.UnitId)}"
              style="height:32px;padding:0 10px;background:var(--green-dark);color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;">Update mi</button>
          </div>
        </div>
      </a>`;
  }).join('');

  // Empty state
  const emptyHtml = !filteredUnits.length ? `
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <input id="newUnitId" type="text" placeholder="Unit ID *" maxlength="30"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
          <select id="newUnitType" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
            <option value="Truck">Truck</option>
            <option value="Trailer">Trailer</option>
            <option value="Van">Van</option>
            <option value="Reefer">Reefer</option>
            <option value="Other">Other</option>
          </select>
          <input id="newUnitVIN" type="text" placeholder="VIN" maxlength="17"
            style="grid-column:1/-1;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
          <input id="newUnitPlate" type="text" placeholder="Plate #" maxlength="15"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
          <input id="newUnitMake" type="text" placeholder="Make" maxlength="30"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
          <input id="newUnitModel" type="text" placeholder="Model" maxlength="30"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
          <input id="newUnitYear" type="text" placeholder="Year" maxlength="4" inputmode="numeric"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
          <input id="newUnitDot" type="date" placeholder="DOT Expiry"
            style="grid-column:1/-1;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg);color:var(--text);">
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;justify-content:center;">
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
      ${renderSamsaraBadge()}
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
      ${summaryBarHtml}
      ${searchFilterHtml}

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

  // Wire search input (B6)
  const searchInput = document.getElementById('dashSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      _searchQuery = e.target.value;
      renderDashboard(container, allMaintenance, allCondition);
    });
    // Restore focus if search was active
    if (_searchQuery) {
      searchInput.focus();
      searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
    }
  }

  // Wire status filter (B6)
  const statusSelect = document.getElementById('dashStatusFilter');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      _statusFilter = e.target.value;
      renderDashboard(container, allMaintenance, allCondition);
    });
  }

  // Wire quick mileage update (D16)
  container.querySelectorAll('[data-action="quick-mileage"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const unitId = btn.dataset.unitId;
      const input = container.querySelector(`[data-mileage-unit="${unitId}"]`);
      const miles = (input?.value || '').trim().replace(/,/g, '');
      if (!miles || isNaN(Number(miles))) return;

      btn.disabled = true;
      btn.textContent = '...';
      try {
        const token = await getValidToken();
        await saveConditionUpdate(unitId, { CurrentMiles: miles }, token, state.fleet.conditionPath);
        input.value = '';
        input.placeholder = Number(miles).toLocaleString();
        btn.textContent = 'Done!';
        setTimeout(() => { btn.textContent = 'Update mi'; btn.disabled = false; }, 1500);
      } catch (err) {
        console.error('Quick mileage update failed:', err);
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Update mi'; btn.disabled = false; }, 2000);
      }
    });
  });

  // Prevent card navigation when clicking mileage inputs (D16)
  container.querySelectorAll('[data-mileage-unit]').forEach(input => {
    input.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
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

  const row = {
    UnitId: unitId,
    Type: typeSelect.value,
    VIN: (document.getElementById('newUnitVIN')?.value || '').trim(),
    PlateNr: (document.getElementById('newUnitPlate')?.value || '').trim(),
    Make: (document.getElementById('newUnitMake')?.value || '').trim(),
    Model: (document.getElementById('newUnitModel')?.value || '').trim(),
    Year: (document.getElementById('newUnitYear')?.value || '').trim(),
    DotExpiry: (document.getElementById('newUnitDot')?.value || '').trim(),
  };

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


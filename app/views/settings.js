/**
 * Settings view — milestone CRUD per equipment type and due-soon threshold editing.
 * Native ES module. Follows unit-detail.js patterns for event delegation and toast.
 */

import { state } from '../state.js';
import { getValidToken } from '../graph/auth.js';
import {
  saveMilestoneConfig,
  saveDueSoonThresholds,
  getDueSoonThresholds,
  getMilestonesForCategory,
  MILESTONE_CONFIG_HEADERS,
} from '../maintenance/milestones.js';
// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Show a brief toast notification.
 * @param {HTMLElement} container
 * @param {string} msg
 * @param {string} [type] - 'success' | 'error'
 */
function showToast(container, msg, type = '') {
  const t = container.querySelector('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 3500);
}

/**
 * Escape HTML entities for safe innerHTML use.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Slugify a label string — lowercase, spaces to hyphens, strip non-alphanumeric.
 * e.g. "Engine Air Filter" -> "engine-air-filter"
 * @param {string} label
 * @returns {string}
 */
function slugify(label) {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Auto-discover equipment types from state.fleet.units.
 * @returns {string[]} Sorted array of type strings
 */
function discoverTypes() {
  const units = state.fleet.units || [];
  const types = new Set(units.map(u => (u.Type || 'Other').trim()).filter(Boolean));
  return [...types].sort();
}

/**
 * Get all non-_config milestone rows from state.fleet.milestoneConfig.
 * @returns {Array<Object>}
 */
function getNonConfigRows() {
  return (state.fleet.milestoneConfig || []).filter(
    r => (r.Category || '').trim() !== '_config'
  );
}

/**
 * Format interval display string for a milestone row.
 * @param {Object} row - CSV row with IntervalMiles and IntervalDays
 * @returns {string}
 */
function formatInterval(row) {
  const miles = row.IntervalMiles ? Number(row.IntervalMiles).toLocaleString() + ' mi' : '';
  const days = row.IntervalDays ? row.IntervalDays + ' days' : '';
  if (miles && days) return `${miles} / ${days}`;
  return miles || days || '—';
}

// ── Render ────────────────────────────────────────────────────────────────────

const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 12H5M12 19l-7-7 7-7"/>
</svg>`;

/**
 * Render the settings page into the given container.
 * @param {HTMLElement} container
 */
export function render(container) {
  if (!state.token) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="color:var(--text-2);">Please sign in first.</p>
        <a href="#upload" style="color:var(--green-dark);">Back to sign in</a>
      </div>`;
    return;
  }

  _renderPage(container);
  _wireEvents(container);
}

function _renderPage(container) {
  const types = discoverTypes();
  const thresholds = getDueSoonThresholds();

  container.innerHTML = `
    <div style="padding:16px;max-width:600px;margin:0 auto;" id="settingsRoot">
      <div id="toast" class="toast"></div>

      <a href="#dashboard" class="back-link">
        ${BACK_SVG}
        Dashboard
      </a>

      <h2 style="margin:12px 0 20px;">Settings</h2>

      ${types.length === 0 ? `
        <p style="color:var(--text-2);font-size:14px;">No equipment types found. Add units to your fleet first.</p>
      ` : types.map(type => _renderTypeSection(type)).join('')}

      <div style="margin-top:28px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
        <div style="background:var(--bg-2);padding:10px 14px;font-weight:600;font-size:14px;">
          Due Soon Thresholds
        </div>
        <div style="padding:14px;background:var(--bg);">
          <p style="color:var(--text-2);font-size:12px;margin:0 0 12px;">Alert when a milestone is this close to being due.</p>
          <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">
            <div>
              <label style="display:block;font-size:12px;color:var(--text-2);margin-bottom:4px;">Miles before due</label>
              <input id="threshMiles" type="number" min="1" value="${escapeHtml(String(thresholds.dueSoonMiles))}"
                style="width:100px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;background:var(--bg);color:var(--text);">
            </div>
            <div>
              <label style="display:block;font-size:12px;color:var(--text-2);margin-bottom:4px;">Days before due</label>
              <input id="threshDays" type="number" min="1" value="${escapeHtml(String(thresholds.dueSoonDays))}"
                style="width:80px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;background:var(--bg);color:var(--text);">
            </div>
            <button data-action="save-thresholds"
              style="padding:6px 16px;background:var(--green-dark);color:#fff;border:none;border-radius:var(--radius);font-size:13px;cursor:pointer;">
              Save Thresholds
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function _renderTypeSection(type) {
  const milestones = getNonConfigRows().filter(
    r => (r.Category || '').trim().toLowerCase() === type.toLowerCase()
  );

  return `
    <div class="settings-type-section" data-type="${escapeHtml(type)}"
      style="margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
      <button data-action="toggle-type" data-type="${escapeHtml(type)}"
        style="width:100%;text-align:left;padding:10px 14px;background:var(--bg-2);border:none;cursor:pointer;
               font-size:14px;font-weight:600;color:var(--text);display:flex;justify-content:space-between;align-items:center;">
        <span>${escapeHtml(type)}</span>
        <span class="toggle-chevron" data-type="${escapeHtml(type)}" style="font-size:12px;color:var(--text-2);">&#9660;</span>
      </button>
      <div class="type-body" data-type="${escapeHtml(type)}" style="background:var(--bg);">
        ${_renderMilestoneList(type, milestones)}
        <div style="padding:8px 14px 12px;">
          <button data-action="add-milestone" data-type="${escapeHtml(type)}"
            style="font-size:12px;color:var(--green-dark);background:none;border:1px solid var(--green-dark);
                   padding:4px 12px;border-radius:var(--radius);cursor:pointer;">
            + Add Milestone
          </button>
        </div>
        <div class="add-form" data-type="${escapeHtml(type)}" style="display:none;padding:10px 14px 14px;border-top:1px solid var(--border);">
          ${_renderAddForm(type)}
        </div>
      </div>
    </div>`;
}

function _renderMilestoneList(type, milestones) {
  if (milestones.length === 0) {
    return `<p style="padding:10px 14px;font-size:13px;color:var(--text-2);margin:0;">No milestones configured.</p>`;
  }
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;" class="ms-table" data-type="${escapeHtml(type)}">
      <thead>
        <tr style="border-bottom:1px solid var(--border);">
          <th style="padding:6px 14px;text-align:left;color:var(--text-2);font-weight:500;font-size:11px;">Milestone</th>
          <th style="padding:6px 14px;text-align:left;color:var(--text-2);font-weight:500;font-size:11px;">Interval</th>
          <th style="padding:6px 14px;text-align:right;color:var(--text-2);font-weight:500;font-size:11px;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${milestones.map((ms, i) => _renderMilestoneRow(type, ms, i)).join('')}
      </tbody>
    </table>`;
}

function _renderMilestoneRow(type, ms, i) {
  const key = `${escapeHtml(type)}-${escapeHtml(ms.Type || String(i))}`;
  return `
    <tr data-milestone-type="${escapeHtml(ms.Type)}" data-ms-category="${escapeHtml(type)}" id="ms-row-${key}"
      style="border-bottom:1px solid var(--border);">
      <td style="padding:8px 14px;">${escapeHtml(ms.Label || ms.Type)}</td>
      <td style="padding:8px 14px;color:var(--text-2);">${formatInterval(ms)}</td>
      <td style="padding:8px 14px;text-align:right;white-space:nowrap;">
        <button data-action="edit-milestone" data-type="${escapeHtml(type)}" data-milestone-type="${escapeHtml(ms.Type)}"
          style="font-size:11px;color:var(--green-dark);background:none;border:1px solid var(--green-dark);
                 padding:2px 8px;border-radius:6px;cursor:pointer;margin-right:4px;">Edit</button>
        <button data-action="delete-milestone" data-type="${escapeHtml(type)}" data-milestone-type="${escapeHtml(ms.Type)}"
          style="font-size:11px;color:#dc3545;background:none;border:1px solid #dc3545;
                 padding:2px 8px;border-radius:6px;cursor:pointer;">Delete</button>
      </td>
    </tr>
    <tr id="ms-edit-${key}" style="display:none;background:var(--bg-2);">
      <td colspan="3" style="padding:10px 14px;">
        ${_renderEditForm(type, ms)}
      </td>
    </tr>
    <tr id="ms-confirm-${key}" style="display:none;background:#fff5f5;">
      <td colspan="3" style="padding:10px 14px;">
        <span style="font-size:13px;">Delete <strong>${escapeHtml(ms.Label || ms.Type)}</strong>?</span>
        <button data-action="confirm-delete" data-type="${escapeHtml(type)}" data-milestone-type="${escapeHtml(ms.Type)}"
          style="margin-left:12px;font-size:12px;color:#fff;background:#dc3545;border:none;padding:3px 10px;border-radius:6px;cursor:pointer;">
          Confirm
        </button>
        <button data-action="cancel-delete" data-type="${escapeHtml(type)}" data-milestone-type="${escapeHtml(ms.Type)}"
          style="margin-left:6px;font-size:12px;color:var(--text-2);background:none;border:none;cursor:pointer;">
          Cancel
        </button>
      </td>
    </tr>`;
}

function _renderEditForm(type, ms) {
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      <div>
        <label style="display:block;font-size:11px;color:var(--text-2);margin-bottom:2px;">Label</label>
        <input class="edit-label" type="text" value="${escapeHtml(ms.Label || ms.Type)}"
          style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);width:130px;">
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-2);margin-bottom:2px;">Miles</label>
        <input class="edit-miles" type="number" min="0" value="${escapeHtml(ms.IntervalMiles || '')}"
          style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);width:90px;">
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-2);margin-bottom:2px;">Days</label>
        <input class="edit-days" type="number" min="0" value="${escapeHtml(ms.IntervalDays || '')}"
          style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);width:70px;">
      </div>
      <button data-action="save-edit-milestone" data-type="${escapeHtml(type)}" data-milestone-type="${escapeHtml(ms.Type)}"
        style="padding:4px 12px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">
        Save
      </button>
      <button data-action="cancel-edit-milestone" data-type="${escapeHtml(type)}" data-milestone-type="${escapeHtml(ms.Type)}"
        style="padding:4px 8px;background:none;border:none;color:var(--text-2);font-size:12px;cursor:pointer;">
        Cancel
      </button>
    </div>`;
}

function _renderAddForm(type) {
  return `
    <p style="font-size:12px;color:var(--text-2);margin:0 0 8px;">Add a new milestone for <strong>${escapeHtml(type)}</strong>.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      <div>
        <label style="display:block;font-size:11px;color:var(--text-2);margin-bottom:2px;">Label *</label>
        <input class="new-label" type="text" placeholder="e.g. Oil Change"
          style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);width:130px;">
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-2);margin-bottom:2px;">Miles</label>
        <input class="new-miles" type="number" min="0" placeholder="e.g. 30000"
          style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);width:90px;">
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-2);margin-bottom:2px;">Days</label>
        <input class="new-days" type="number" min="0" placeholder="e.g. 365"
          style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);width:70px;">
      </div>
      <button data-action="save-add-milestone" data-type="${escapeHtml(type)}"
        style="padding:4px 12px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">
        Save
      </button>
      <button data-action="cancel-add-milestone" data-type="${escapeHtml(type)}"
        style="padding:4px 8px;background:none;border:none;color:var(--text-2);font-size:12px;cursor:pointer;">
        Cancel
      </button>
    </div>`;
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function _wireEvents(container) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const type = btn.dataset.type;
    const milestoneType = btn.dataset.milestoneType;

    // ── Toggle accordion ─────────────────────────────────────────────────────
    if (action === 'toggle-type') {
      const body = container.querySelector(`.type-body[data-type="${type}"]`);
      const chevron = container.querySelector(`.toggle-chevron[data-type="${type}"]`);
      if (!body) return;
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? '' : 'none';
      if (chevron) chevron.innerHTML = isHidden ? '&#9660;' : '&#9654;';
      return;
    }

    // ── Add milestone ────────────────────────────────────────────────────────
    if (action === 'add-milestone') {
      const form = container.querySelector(`.add-form[data-type="${type}"]`);
      if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
      return;
    }

    if (action === 'cancel-add-milestone') {
      const form = container.querySelector(`.add-form[data-type="${type}"]`);
      if (form) form.style.display = 'none';
      return;
    }

    if (action === 'save-add-milestone') {
      const form = container.querySelector(`.add-form[data-type="${type}"]`);
      if (!form) return;
      const label = (form.querySelector('.new-label')?.value || '').trim();
      const miles = (form.querySelector('.new-miles')?.value || '').trim();
      const days = (form.querySelector('.new-days')?.value || '').trim();

      if (!label) { showToast(container, 'Label is required', 'error'); return; }
      if (!miles && !days) { showToast(container, 'At least one interval (miles or days) is required', 'error'); return; }

      const newRow = {
        Category: type,
        Type: slugify(label),
        Label: label,
        IntervalMiles: miles || '',
        IntervalDays: days || '',
      };

      try {
        const token = await getValidToken();
        const allNonConfig = getNonConfigRows();
        await saveMilestoneConfig([...allNonConfig, newRow], token);
        showToast(container, 'Milestone added', 'success');
        _renderPage(container);
        _wireEvents(container);
      } catch (err) {
        showToast(container, 'Save failed: ' + err.message, 'error');
      }
      return;
    }

    // ── Edit milestone ───────────────────────────────────────────────────────
    if (action === 'edit-milestone') {
      const key = `${type}-${milestoneType}`;
      const editRow = container.querySelector(`#ms-edit-${key}`);
      if (editRow) editRow.style.display = editRow.style.display === 'none' ? '' : 'none';
      return;
    }

    if (action === 'cancel-edit-milestone') {
      const key = `${type}-${milestoneType}`;
      const editRow = container.querySelector(`#ms-edit-${key}`);
      if (editRow) editRow.style.display = 'none';
      return;
    }

    if (action === 'save-edit-milestone') {
      const key = `${type}-${milestoneType}`;
      const editRow = container.querySelector(`#ms-edit-${key}`);
      if (!editRow) return;

      const label = (editRow.querySelector('.edit-label')?.value || '').trim();
      const miles = (editRow.querySelector('.edit-miles')?.value || '').trim();
      const days = (editRow.querySelector('.edit-days')?.value || '').trim();

      if (!label) { showToast(container, 'Label is required', 'error'); return; }

      try {
        const token = await getValidToken();
        const allNonConfig = getNonConfigRows().map(r => {
          if ((r.Category || '').trim().toLowerCase() === type.toLowerCase() &&
              (r.Type || '').trim() === milestoneType) {
            return { ...r, Label: label, IntervalMiles: miles || '', IntervalDays: days || '' };
          }
          return r;
        });
        await saveMilestoneConfig(allNonConfig, token);
        showToast(container, 'Milestone updated', 'success');
        _renderPage(container);
        _wireEvents(container);
      } catch (err) {
        showToast(container, 'Save failed: ' + err.message, 'error');
      }
      return;
    }

    // ── Delete milestone ─────────────────────────────────────────────────────
    if (action === 'delete-milestone') {
      const key = `${type}-${milestoneType}`;
      const confirmRow = container.querySelector(`#ms-confirm-${key}`);
      if (confirmRow) confirmRow.style.display = confirmRow.style.display === 'none' ? '' : 'none';
      return;
    }

    if (action === 'cancel-delete') {
      const key = `${type}-${milestoneType}`;
      const confirmRow = container.querySelector(`#ms-confirm-${key}`);
      if (confirmRow) confirmRow.style.display = 'none';
      return;
    }

    if (action === 'confirm-delete') {
      try {
        const token = await getValidToken();
        const remaining = getNonConfigRows().filter(r =>
          !((r.Category || '').trim().toLowerCase() === type.toLowerCase() &&
            (r.Type || '').trim() === milestoneType)
        );
        await saveMilestoneConfig(remaining, token);
        showToast(container, 'Milestone deleted', 'success');
        _renderPage(container);
        _wireEvents(container);
      } catch (err) {
        showToast(container, 'Delete failed: ' + err.message, 'error');
      }
      return;
    }

    // ── Save thresholds ──────────────────────────────────────────────────────
    if (action === 'save-thresholds') {
      const milesInput = container.querySelector('#threshMiles');
      const daysInput = container.querySelector('#threshDays');
      const miles = Number(milesInput?.value || 0);
      const days = Number(daysInput?.value || 0);

      if (!miles || miles <= 0) { showToast(container, 'Miles threshold must be greater than 0', 'error'); return; }
      if (!days || days <= 0) { showToast(container, 'Days threshold must be greater than 0', 'error'); return; }

      try {
        const token = await getValidToken();
        await saveDueSoonThresholds(miles, days, token);
        showToast(container, 'Thresholds saved', 'success');
      } catch (err) {
        showToast(container, 'Save failed: ' + err.message, 'error');
      }
      return;
    }
  });
}

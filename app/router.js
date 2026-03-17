/**
 * Hash-based SPA router.
 * Native ES module.
 */

import { render as renderUpload } from './views/upload.js';
import { render as renderUnitDetail } from './views/unit-detail.js';
import { render as renderDashboard } from './views/dashboard.js';

const ROUTES = {
  '#upload':    renderUpload,
  '#unit':      renderUnitDetail,
  '#dashboard': renderDashboard,
};

export function initRouter(container) {
  const go = () => {
    const hash = window.location.hash || '#dashboard';
    const key  = hash.split('?')[0];
    const params = Object.fromEntries(
      new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '')
    );
    const fn   = ROUTES[key] || renderDashboard;
    container.innerHTML = '';
    fn(container, params);
  };
  window.addEventListener('hashchange', go);
  go(); // initial render
}

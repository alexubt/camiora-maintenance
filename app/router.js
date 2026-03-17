/**
 * Hash-based SPA router.
 * Native ES module.
 */

import { render as renderUpload } from './views/upload.js';

const ROUTES = {
  '#upload': renderUpload,
};

export function initRouter(container) {
  const go = () => {
    const hash = window.location.hash || '#upload';
    const key  = hash.split('?')[0];
    const fn   = ROUTES[key] || renderUpload;
    container.innerHTML = '';
    fn(container);
  };
  window.addEventListener('hashchange', go);
  go(); // initial render
}

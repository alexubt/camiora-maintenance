/**
 * Install prompt logic for iOS and Android.
 * Appends banners to document.body so they survive route changes.
 */

let deferredInstallPrompt = null;

/** True on iPhone/iPad/iPod when NOT already in standalone mode. */
export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !isInstalled();
}

/** True if running as installed PWA (standalone). */
export function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true
  );
}

// Capture the beforeinstallprompt event (Android / desktop Chrome)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showAndroidBanner();
});

/**
 * Called from main.js after router init.
 * Shows platform-appropriate install banner if not already installed / dismissed.
 */
export function initInstallPrompt() {
  if (isInstalled()) return;
  if (sessionStorage.getItem('install_dismissed')) return;
  if (isIOS()) showIOSBanner();
  // Android banner is triggered by beforeinstallprompt event above
}

function dismissBanner(el) {
  sessionStorage.setItem('install_dismissed', '1');
  el.remove();
}

function showIOSBanner() {
  // Avoid duplicate banners
  if (document.querySelector('.install-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'install-banner';
  banner.innerHTML =
    '<span class="install-text">Install Camiora: tap <b>Share</b> (box-arrow icon) then <b>"Add to Home Screen"</b></span>' +
    '<button class="install-dismiss" aria-label="Dismiss">&times;</button>';

  banner.querySelector('.install-dismiss').addEventListener('click', () => dismissBanner(banner));

  document.body.appendChild(banner);
}

function showAndroidBanner() {
  if (isInstalled()) return;
  if (sessionStorage.getItem('install_dismissed')) return;
  // Avoid duplicate banners
  if (document.querySelector('.install-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'install-banner';
  banner.innerHTML =
    '<span class="install-text">Install Camiora for quick access</span>' +
    '<button class="install-action">Install</button>' +
    '<button class="install-dismiss" aria-label="Dismiss">&times;</button>';

  banner.querySelector('.install-action').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    banner.remove();
    if (outcome === 'dismissed') {
      sessionStorage.setItem('install_dismissed', '1');
    }
  });

  banner.querySelector('.install-dismiss').addEventListener('click', () => dismissBanner(banner));

  document.body.appendChild(banner);
}

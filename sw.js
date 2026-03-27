const CACHE = 'camiora-v26';
const STATIC = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './app/main.js',
  './app/state.js',
  './app/router.js',
  './app/install.js',
  './app/views/upload.js',
  './app/views/dashboard.js',
  './app/views/unit-detail.js',
  './app/imaging/scanner.js',
  './app/graph/auth.js',
  './app/graph/csv.js',
  './app/graph/files.js',
  './app/invoice/extract.js',
  './app/invoice/batch-milestone.js',
  './app/invoice/naming.js',
  './app/invoice/record.js',
  './app/maintenance/schedule.js',
  './app/maintenance/milestones.js',
  './app/storage/cache.js',
  './app/storage/db.js',
  './app/storage/uploadQueue.js',
  './app/samsara/sync.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Never intercept navigation requests — let the auth redirect flow through
  if (e.request.mode === 'navigate') return;

  // Network-first for CDN assets (Tesseract, etc.)
  if (e.request.url.includes('cdn.jsdelivr.net') || e.request.url.includes('cdnjs.cloudflare.com') || e.request.url.includes('unpkg.com')) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

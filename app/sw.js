var CACHE_NAME = 'shift-reminder-v1';
var STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './js/auth.js',
  './js/views/login.js',
  './js/views/dashboard.js',
  './js/views/calendar.js',
  './js/views/upload.js',
  './js/views/staffManager.js',
  './js/views/reminder.js',
  './js/views/logs.js',
  './js/components/nav.js',
  './js/components/shiftCard.js',
  './js/components/modal.js',
  './manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
          .map(function (n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// Network First, Cache Fallback
self.addEventListener('fetch', function (e) {
  // API calls: network only
  if (e.request.url.indexOf('script.google.com') >= 0 || e.request.url.indexOf('macros') >= 0) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request).then(function (res) {
      var clone = res.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(e.request, clone);
      });
      return res;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});

/**
 * Peak 10 Intelligence — Service Worker
 * 
 * Handles:
 * - Caching static assets for offline shell
 * - Background sync for digest notifications
 * - Badge count updates via periodic sync
 */

const CACHE_NAME = 'peak10-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Install — cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — network-first for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // API requests: always go to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Offline' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503,
        });
      })
    );
    return;
  }
  
  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Periodic background sync — update badge count
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-badge') {
    event.waitUntil(updateBadge());
  }
});

async function updateBadge() {
  try {
    const response = await fetch('/api/dashboard');
    const data = await response.json();
    
    const criticalCount = data?.inbound?.counts?.critical || 0;
    const importantCount = data?.inbound?.counts?.important || 0;
    const total = criticalCount + importantCount;
    
    if (navigator.setAppBadge && total > 0) {
      navigator.setAppBadge(total);
    } else if (navigator.clearAppBadge) {
      navigator.clearAppBadge();
    }
  } catch {
    // Offline or error — skip badge update
  }
}

// Push notification handler (for morning digest)
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  const options = {
    body: data.body || 'You have items that need attention.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'peak10-notification',
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Open Dashboard' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Peak 10 Intelligence', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});

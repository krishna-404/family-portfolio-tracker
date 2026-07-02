import { isDev } from '@frontend/configs/env.config';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_DISABLE_DEV_LOGS?: boolean;
};

if (isDev) {
  self.__WB_DISABLE_DEV_LOGS = true;
}

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

if (isDev) {
  self.addEventListener('install', () => {
    self.skipWaiting();
  });
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

try {
  // Use index.html without leading slash as it's the standard key in the precache manifest.
  // In development, this might fail because the manifest is handled differently by Vite.
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
} catch (err) {
  if (!isDev) {
    console.warn('[SW] NavigationRoute registration failed:', err);
  } else {
    console.debug('[SW] NavigationRoute skipped in dev mode (standard behavior).');
  }
}

// ─── OPFS virtual-media fetch handler ───────────────────────────────────
//
// Serves locally-cached blobs stored in OPFS at paths like
// `files/{id}/original.jpg`. `<img src="/opfs-media/files/abc/original.jpg" />`
// resolves via this handler so the UI can render pending uploads before
// they've been pushed to the CDN — same URL shape as the CDN URL so
// swapping to the CDN URL post-upload doesn't cause a re-fetch flicker.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/opfs-media/')) return;

  const opfsPath = url.pathname.slice('/opfs-media/'.length);
  event.respondWith(
    (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const parts = opfsPath.split('/');
        const fileName = parts.pop();
        if (!fileName) return new Response(null, { status: 404 });

        let dir: FileSystemDirectoryHandle = root;
        for (const part of parts) {
          dir = await dir.getDirectoryHandle(part);
        }
        const fileHandle = await dir.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        return new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    })(),
  );
});

/* WMS+ mobile PWA: receives Web Push while the app is closed. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { body: event.data ? event.data.text() : '' };
    }
    const title = payload.title || 'WMS+';
    const options = {
        body: payload.body || 'Новое уведомление.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: payload.tag || 'wmsplus-notification',
        data: { url: payload.url || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find((client) => client.url.startsWith(self.location.origin));
        if (existing) {
            await existing.focus();
            if ('navigate' in existing) await existing.navigate(destination);
            return;
        }
        await self.clients.openWindow(destination);
    })());
});

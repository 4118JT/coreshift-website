const CACHE_NAME = "coreshift-shell-v6";
const APP_SHELL = ["/manifest.webmanifest", "/favicon.svg", "/coreshift-apple-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !APP_SHELL.includes(url.pathname)) return;

  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client && new URL(client.url).pathname === href);
      if (existing) return existing.focus();
      return self.clients.openWindow(href);
    }),
  );
});

// Push events are delivered by the phone's notification service, even when
// CoreShift is closed or the browser has suspended its background tabs.
self.addEventListener("push", (event) => {
  const fallback = { title: "CoreShift", body: "You have a new update.", href: "/" };
  const payload = event.data ? event.data.json().catch(() => fallback) : Promise.resolve(fallback);
  event.waitUntil(
    payload.then((message) => self.registration.showNotification(message.title || fallback.title, {
      body: message.body || fallback.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: message.tag || `coreshift-${Date.now()}`,
      renotify: false,
      data: { href: message.href || fallback.href },
    })),
  );
});

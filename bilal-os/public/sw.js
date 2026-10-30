// Minimal service worker: makes the dashboard installable and shows a friendly
// page when offline. Live data is never cached.
const OFFLINE = "<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:system-ui;background:#0d0f13;color:#e8eaee;display:grid;place-items:center;height:100vh'><div>Bilal OS is offline. Check your connection.</div>";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html" } })));
});

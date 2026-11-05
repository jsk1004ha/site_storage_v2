"use strict";

const CACHE_NAME = "remember-web-cache-v2";
const APP_ROOT_URL = new URL("./", self.location.href);
const APP_ENTRY_URL = new URL("./index.html", self.location.href);

function isAppEntry(url) {
  return url.origin === APP_ROOT_URL.origin &&
    (url.pathname === APP_ROOT_URL.pathname || url.pathname === APP_ENTRY_URL.pathname);
}
const APP_SHELL = [
  "./",
  "./index.html",
  "./app-style.css",
  "./app.js",
  "./icons/site.webmanifest",
  "./icons/favicon.ico",
  "./icons/favicon-16x16.png",
  "./icons/favicon-32x32.png",
  "./icons/apple-touch-icon.png",
  "./icons/android-chrome-192x192.png",
  "./icons/android-chrome-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
          if (response.status === 200 && contentType === "text/html" &&
              !response.redirected && isAppEntry(requestUrl) &&
              response.url && isAppEntry(new URL(response.url))) {
            const cloned = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME)
                .then((cache) => cache.put("./index.html", cloned))
                // A cache quota/write failure must not discard the online page.
                .catch(() => {})
            );
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("./index.html");
          return cached || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          // Only validated navigation responses may update an app entry. A
          // fetch/prefetch of index.html must not bypass the shell checks above.
          if (response && response.ok && !isAppEntry(requestUrl)) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || fetchPromise;
    })
  );
});

"use strict";

// Increment v1 -> v2 -> v3 whenever publishing a new website release.
const CACHE_VERSION = "v1";
const APP_URL = new URL(self.registration.scope);
const SCOPE_KEY = APP_URL.pathname === "/" ? "root" : encodeURIComponent(APP_URL.pathname);
const CACHE_PREFIX = `dashboard-skki-${SCOPE_KEY}-`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const STATIC_FILES = new Map([
  ["style.css", "style"],
  ["portal.css", "style"],
  ["login.css", "style"],
  ["script.js", "script"],
  ["api.js", "script"], // Frontend code only, never the API response.
  ["kpi.js", "script"],
  ["auth.js", "script"],
  ["login.js", "script"],
  ["cursor-effect.js", "script"],
  ["pwa.js", "script"],
  ["assets/chart.umd.min.js", "script"],
  ["assets/logo.svg", "image"],
  ["assets/logo-pln.png", "image"],
  ["assets/peta-wilayah-up3-cirebon.png", "image"],
  ["assets/pln-up3-cirebon-login-bg.png", "image"],
  ["assets/pln-up3-cirebon-login-mobile.png", "image"],
  ["icons/icon-192.png", "image"],
  ["icons/icon-512.png", "image"],
  ["icons/icon-maskable-512.png", "image"]
].map(([path, destination]) => [new URL(path, APP_URL).pathname, destination]));

// Runtime caching only: missing optional icons cannot fail SW installation.
// Use the normal waiting lifecycle so an update does not interrupt open tabs.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isStaticRequest(request) {
  if (request.method !== "GET" || request.mode === "navigate" ||
      request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== APP_URL.origin) return false;
  const destination = STATIC_FILES.get(url.pathname);
  if (!destination || request.destination !== destination) return false;
  // Only existing asset version parameters are allowed, never action/token/data.
  return Array.from(url.searchParams.keys()).every((key) => key === "v");
}

function isCacheable(response, destination) {
  if (!response.ok || response.status !== 200 || response.redirected ||
      response.type !== "basic" || /no-store|private/i.test(response.headers.get("cache-control") || "")) {
    return false;
  }
  const type = response.headers.get("content-type") || "";
  if (destination === "style") return /^text\/css\b/i.test(type);
  if (destination === "script") return /^(?:text|application)\/(?:javascript|ecmascript|x-javascript)\b/i.test(type);
  return destination === "image" && /^image\//i.test(type);
}

async function networkFirst(request) {
  let response;
  try {
    // Bypass the browser HTTP cache as well: always request current online assets.
    response = await fetch(new Request(request, { cache: "no-store" }));
  } catch (error) {
    if (request.signal.aborted) throw error;
    try {
      const cache = await caches.open(CACHE_NAME);
      // Exact URL match retains ?v=; never substitute another release's URL.
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch (cacheError) {
      console.warn("[PWA] Cache aset tidak dapat dibaca:", cacheError);
    }
    throw error;
  }

  if (isCacheable(response, request.destination)) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch (error) {
      // Storage quota/permission failures must never block the network response.
      console.warn("[PWA] Aset tidak dapat disimpan ke cache:", error);
    }
  }
  // HTTP errors remain HTTP errors; do not hide them with stale cached content.
  return response;
}

self.addEventListener("fetch", (event) => {
  if (isStaticRequest(event.request)) {
    event.respondWith(networkFirst(event.request));
  }
});

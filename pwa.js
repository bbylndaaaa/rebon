/* PWA only: no changes to the dashboard, authentication, or API requests. */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator) || !window.isSecureContext ||
      !/^https?:$/.test(window.location.protocol)) return;

  // Resolve from this script, independently of history.replaceState().
  const script = document.currentScript;
  if (!script || !script.src) return;
  const baseURL = new URL("./", script.src);

  async function registerPWA() {
    try {
      const registration = await navigator.serviceWorker.register(
        new URL("service-worker.js", baseURL).href,
        { scope: baseURL.href, updateViaCache: "none" }
      );
      // Check on every page load; never force a reload during user activity.
      try {
        await registration.update();
      } catch (error) {
        console.warn("[PWA] Pemeriksaan pembaruan gagal:", error);
      }
    } catch (error) {
      console.warn("[PWA] Registrasi service worker gagal:", error);
    }
  }

  if (document.readyState === "complete") registerPWA();
  else window.addEventListener("load", registerPWA, { once: true });
})();

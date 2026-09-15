"use strict";

// Sembunyikan nama file HTML dari kolom alamat. Query dashboard tetap
// dipertahankan agar pilihan SKKI/KPI tidak berubah saat halaman dimuat ulang.
if (/\/(?:portal|index)\.html$/.test(window.location.pathname)) {
  window.history.replaceState(
    null,
    "",
    "/" + window.location.search + window.location.hash
  );
}

window.AUTH_CONFIG = Object.freeze({
  API_URL: "https://script.google.com/macros/s/AKfycbyF-avTwks-UU-udRxWXRWqtIjwQ2qvhbgpvIaGxjT9stb-BwzXytsUL4y1MHS3MhtHKQ/exec",
  LOGIN_URL: "login.html",
  SESSION_KEY: "dashboard_auth_session"
});

window.getAuthSession = function () {
  try { return JSON.parse(sessionStorage.getItem(window.AUTH_CONFIG.SESSION_KEY) || "null"); }
  catch (_) { return null; }
};

window.getAuthToken = function () {
  const session = window.getAuthSession();
  return session && session.token ? session.token : "";
};

async function authRequest_(payload) {
  const response = await fetch(window.AUTH_CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow"
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

window.logoutDashboard = async function () {
  const token = window.getAuthToken();
  sessionStorage.removeItem(window.AUTH_CONFIG.SESSION_KEY);
  try { if (token) await authRequest_({ action: "logout", token }); } catch (_) {}
  window.location.reload();
};

// Gerbang login dinonaktifkan: halaman dashboard langsung ditampilkan tanpa
// redirect ke login.html dan tanpa validasi token ke server. Fungsi sesi di
// atas tetap ada agar kpi.js dan tombol logout tidak error jika dipanggil.
(function revealDashboard() {
  document.documentElement.classList.remove("auth-pending");
  const session = window.getAuthSession();
  const bindAccountControls = () => {
    const name = document.getElementById("authUserName");
    if (name) name.textContent = (session && session.user && session.user.name) || "Admin";
    const logout = document.getElementById("logoutBtn");
    if (logout) logout.addEventListener("click", window.logoutDashboard, { once: true });
    const portalLogout = document.getElementById("portalLogoutBtn");
    if (portalLogout) portalLogout.addEventListener("click", window.logoutDashboard, { once: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindAccountControls, { once: true });
  else bindAccountControls();
})();
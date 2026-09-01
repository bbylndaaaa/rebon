"use strict";

// Rapikan alamat yang terlihat tanpa mengubah file atau tampilan halaman.
if (window.location.pathname.endsWith("/login.html")) {
  window.history.replaceState(null, "", "/");
}

const LOGIN_CONFIG = Object.freeze({
  API_URL: "https://script.google.com/macros/s/AKfycbyF-avTwks-UU-udRxWXRWqtIjwQ2qvhbgpvIaGxjT9stb-BwzXytsUL4y1MHS3MhtHKQ/exec",
  DASHBOARD_URL: "portal.html",
  REQUEST_TIMEOUT_MS: 30000,
  SESSION_KEY: "dashboard_auth_session"
});

const form = document.getElementById("loginForm");
const identityInput = document.getElementById("loginIdentity");
const passwordInput = document.getElementById("loginPassword");
const passwordToggle = document.getElementById("passwordToggle");
const loginButton = document.getElementById("loginButton");
const loginAlert = document.getElementById("loginAlert");

passwordToggle.addEventListener("click", () => {
  const wasVisible = passwordInput.type === "text";
  passwordInput.type = wasVisible ? "password" : "text";
  passwordToggle.classList.toggle("visible", !wasVisible);
  passwordToggle.setAttribute("aria-pressed", String(!wasVisible));
  passwordToggle.setAttribute("aria-label", wasVisible ? "Tampilkan password" : "Sembunyikan password");
  passwordInput.focus();
});

[identityInput, passwordInput].forEach((input) => {
  input.addEventListener("input", () => {
    input.closest(".form-field").classList.remove("invalid");
    document.getElementById(input === identityInput ? "identityError" : "passwordError").textContent = "";
    hideAlert();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateForm()) return;
  if (!LOGIN_CONFIG.API_URL) {
    showAlert("Endpoint login belum dikonfigurasi. Isi LOGIN_CONFIG.API_URL setelah Google Apps Script di-deploy.");
    return;
  }

  setLoading(true);
  hideAlert();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGIN_CONFIG.REQUEST_TIMEOUT_MS);

  try {
    // text/plain mencegah preflight CORS yang tidak didukung Web App Apps Script.
    const response = await fetch(LOGIN_CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "login",
        identity: identityInput.value.trim(),
        password: passwordInput.value
      }),
      signal: controller.signal,
      redirect: "follow"
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const result = await response.json();

    if (!result || result.ok !== true || !result.token) {
      passwordInput.value = "";
      passwordInput.focus();
      showAlert("Username/email atau password tidak sesuai.");
      return;
    }

    sessionStorage.setItem(LOGIN_CONFIG.SESSION_KEY, JSON.stringify({
      token: result.token,
      expiresAt: result.expiresAt || null,
      user: result.user ? {
        name: result.user.name || "Pengguna",
        role: result.user.role || "User"
      } : null
    }));
    window.location.replace(LOGIN_CONFIG.DASHBOARD_URL);
  } catch (error) {
    showAlert(error.name === "AbortError"
      ? "Proses login terlalu lama. Silakan coba kembali."
      : "Tidak dapat terhubung ke layanan login. Periksa koneksi lalu coba kembali.");
  } finally {
    clearTimeout(timeout);
    setLoading(false);
  }
});

function validateForm() {
  let valid = true;
  const identity = identityInput.value.trim();
  const password = passwordInput.value;
  if (!identity || identity.length > 120) {
    setFieldError(identityInput, "Masukkan username atau email yang valid.", "identityError");
    valid = false;
  }
  if (!password || password.length > 256) {
    setFieldError(passwordInput, "Masukkan password Anda.", "passwordError");
    valid = false;
  }
  return valid;
}

function setFieldError(input, message, errorId) {
  input.closest(".form-field").classList.add("invalid");
  document.getElementById(errorId).textContent = message;
}

function setLoading(loading) {
  loginButton.disabled = loading;
  loginButton.classList.toggle("loading", loading);
  identityInput.readOnly = loading;
  passwordInput.readOnly = loading;
}

function showAlert(message) {
  loginAlert.textContent = message;
  loginAlert.hidden = false;
}

function hideAlert() {
  loginAlert.hidden = true;
  loginAlert.textContent = "";
}

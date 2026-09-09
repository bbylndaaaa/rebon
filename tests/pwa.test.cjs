"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const registration = fs.readFileSync(path.join(root, "pwa.js"), "utf8");

function harness(scope = "https://example.test/") {
  const handlers = {};
  const stores = new Map();
  const calls = [];
  let claims = 0;
  let network = async () => response("current");
  const context = {
    URL, Request, console,
    self: {
      registration: { scope },
      clients: { claim: async () => { claims++; } },
      addEventListener: (name, fn) => { handlers[name] = fn; }
    },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      open: async (name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const data = stores.get(name);
        return {
          match: async (request) => data.get(request.url)?.clone(),
          put: async (request, result) => { data.set(request.url, result.clone()); }
        };
      }
    },
    fetch: async (request) => { calls.push(request); return network(request); }
  };
  vm.runInNewContext(worker, context);
  return {
    context, stores, calls,
    setNetwork: (fn) => { network = fn; },
    get claims() { return claims; },
    activate() {
      let task;
      handlers.activate({ waitUntil: (value) => { task = value; } });
      return task;
    },
    dispatch(request) {
      let task;
      handlers.fetch({ request, respondWith: (value) => { task = value; } });
      return task;
    }
  };
}

function response(body, options = {}) {
  const result = new Response(body, {
    headers: { "Content-Type": "text/css", ...options.headers },
    status: options.status || 200
  });
  Object.defineProperty(result, "type", { value: "basic" });
  if (options.redirected) Object.defineProperty(result, "redirected", { value: true });
  return result;
}

function request(url = "https://example.test/style.css?v=1", destination = "style", options = {}) {
  const result = new Request(url, options);
  Object.defineProperty(result, "destination", { value: destination });
  return result;
}

test("manifest identity, standalone, start route, and icon configuration", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest")));
  assert.equal(manifest.name, "Dashboard");
  assert.equal(manifest.short_name, "Dashboard");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./index.html?app=skki");
  assert.equal(manifest.scope, "./");
  for (const size of [192, 512]) {
    assert.ok(manifest.icons.some((icon) => icon.src === `icons/icon-${size}.png` && icon.sizes === `${size}x${size}`));
  }
  for (const name of ["index.html", "login.html", "portal.html"]) {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal((html.match(/rel="manifest"/g) || []).length, 1);
    assert.equal((html.match(/src="pwa.js"/g) || []).length, 1);
    assert.match(html, /name="theme-color" content="#0b4da2"/);
  }
});

test("API, auth, navigation, CDN, data, and unapproved query strings bypass SW", () => {
  const h = harness();
  const cases = [
    request("https://script.google.com/macros/s/example/exec?action=all", ""),
    request("https://script.googleusercontent.com/data", ""),
    request("https://example.test/api/data", ""),
    request("https://example.test/login", "", { method: "POST", body: "secret" }),
    request("https://example.test/index.html?app=skki", "document"),
    request("https://example.test/?app=kpi", "document"),
    request("https://example.test/login.html", "document"),
    request("https://example.test/manifest.webmanifest", "manifest"),
    request("https://example.test/api.js?action=data", "script"),
    request("https://example.test/style.css?token=secret", "style"),
    request("https://example.test/style.css", ""),
    request("https://example.test/style.css", "style", { headers: { Range: "bytes=0-9" } }),
    request("https://example.test/new-file.js", "script"),
    request("https://cdn.example.test/script.js", "script"),
    request("https://example.test/source.xlsx", "")
  ];
  for (const req of cases) assert.equal(h.dispatch(req), undefined, req.url);
  assert.equal(h.calls.length, 0);
  assert.equal(h.stores.size, 0);
});

test("online requests fetch fresh assets despite an existing cached copy", async () => {
  const h = harness();
  assert.equal(await (await h.dispatch(request())).text(), "current");
  h.setNetwork(async () => response("updated"));
  assert.equal(await (await h.dispatch(request())).text(), "updated");
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every((req) => req.cache === "no-store"));
  assert.equal(await h.stores.get("dashboard-skki-root-v1").get(request().url).text(), "updated");
});

test("offline fallback uses only the exact asset version, never API data", async () => {
  const h = harness();
  await h.dispatch(request());
  h.setNetwork(async () => { throw new TypeError("offline"); });
  assert.equal(await (await h.dispatch(request())).text(), "current");
  await assert.rejects(h.dispatch(request("https://example.test/style.css?v=2")), /offline/);
  assert.equal(h.dispatch(request("https://script.google.com/exec", "")), undefined);
});

test("HTTP errors are returned and not replaced by stale content", async () => {
  const h = harness();
  await h.dispatch(request());
  h.setNetwork(async () => response("server error", { status: 500 }));
  assert.equal((await h.dispatch(request())).status, 500);
});

test("HTML fallbacks, private responses, redirects, and missing icons are not cached", async () => {
  for (const options of [
    { headers: { "Content-Type": "text/html" } },
    { headers: { "Cache-Control": "no-store" } },
    { headers: { "Cache-Control": "private, max-age=60" } },
    { redirected: true },
    { status: 404 }
  ]) {
    const h = harness();
    h.setNetwork(async () => response("not cacheable", options));
    await h.dispatch(request());
    assert.equal(h.stores.size, 0);
  }
  const h = harness();
  h.setNetwork(async () => response("missing", { status: 404 }));
  assert.equal((await h.dispatch(request("https://example.test/icons/icon-192.png", "image"))).status, 404);
  await h.activate();
  assert.equal(h.claims, 1);
});

test("cache storage failure does not prevent returning online assets", async () => {
  const h = harness();
  h.context.console = { warn() {} };
  h.context.caches.open = async () => { throw new Error("quota"); };
  assert.equal(await (await h.dispatch(request())).text(), "current");
});

test("activation deletes only older caches from this application's scope", async () => {
  const h = harness();
  for (const name of ["dashboard-skki-root-v0", "dashboard-skki-root-v1", "other-app-v1", "dashboard-skki-%2Fother%2F-v1"]) {
    h.stores.set(name, new Map());
  }
  await h.activate();
  assert.deepEqual([...h.stores.keys()], ["dashboard-skki-root-v1", "other-app-v1", "dashboard-skki-%2Fother%2F-v1"]);
  assert.equal(h.claims, 1);
});

test("SW allowlist stays inside its own subfolder scope", async () => {
  const h = harness("https://example.test/dashboard/");
  assert.equal(h.dispatch(request()), undefined);
  await h.dispatch(request("https://example.test/dashboard/style.css", "style"));
  assert.ok(h.stores.has("dashboard-skki-%2Fdashboard%2F-v1"));
});

function registrationHarness({ secure = true, supported = true, ready = "loading", registerError = false, updateError = false } = {}) {
  const calls = [];
  const warnings = [];
  let onLoad;
  const context = {
    URL,
    console: { warn: (...args) => warnings.push(args) },
    window: {
      isSecureContext: secure,
      location: { protocol: "https:" },
      addEventListener: (name, fn, options) => { assert.equal(name, "load"); assert.equal(options.once, true); onLoad = fn; }
    },
    document: { readyState: ready, currentScript: { src: "https://example.test/pwa.js" } },
    navigator: supported ? {
      serviceWorker: {
        register: async (url, options) => {
          calls.push({ url, options });
          if (registerError) throw new Error("registration failed");
          return { update: async () => { if (updateError) throw new Error("offline"); } };
        }
      }
    } : {}
  };
  vm.runInNewContext(registration, context);
  return { calls, warnings, run: () => onLoad?.() };
}

test("registration waits for load and disables HTTP caching of worker updates", async () => {
  const h = registrationHarness();
  assert.equal(h.calls.length, 0);
  await h.run();
  assert.equal(h.calls[0].url, "https://example.test/service-worker.js");
  assert.equal(h.calls[0].options.scope, "https://example.test/");
  assert.equal(h.calls[0].options.updateViaCache, "none");
});

test("unsupported/insecure browsers remain unaffected", async () => {
  for (const options of [{ secure: false }, { supported: false }]) {
    const h = registrationHarness(options);
    await h.run();
    assert.equal(h.calls.length, 0);
  }
});

test("registration and update errors are handled without unhandled rejections", async () => {
  for (const options of [{ registerError: true }, { updateError: true }]) {
    const h = registrationHarness(options);
    await h.run();
    assert.equal(h.warnings.length, 1);
  }
});

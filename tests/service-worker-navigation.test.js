const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");

function html(body, status = 200, url = "https://example.test/remember/index.html", redirected = false) {
  const response = new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } });
  return response;
}

function worker({ failWrite = false } = {}) {
  const handlers = new Map();
  let shell = html("working app shell");
  let network;
  let writes = 0;
  const cache = {
    async put(key, value) {
      if (failWrite) throw new Error("cache quota exceeded");
      assert.equal(key, "./index.html");
      shell = value.clone();
      writes += 1;
    },
  };
  vm.runInNewContext(source, {
    self: {
      location: new URL("https://example.test/remember/service-worker.js"),
      addEventListener(name, handler) { handlers.set(name, handler); },
    },
    caches: { open: async () => cache, match: async () => shell.clone() },
    fetch: (...args) => network(...args), URL, Response,
  });
  return {
    get writes() { return writes; },
    cachedText: () => shell.clone().text(),
    async navigate(fetchImpl, pathname = "/remember/index.html") {
      network = fetchImpl;
      const work = [];
      let response;
      handlers.get("fetch")({
        request: { method: "GET", mode: "navigate", url: `https://example.test${pathname}` },
        respondWith(promise) { response = promise; },
        waitUntil(promise) { work.push(promise); },
      });
      const result = await response;
      await Promise.all(work);
      return result;
    },
  };
}

for (const status of [404, 500]) {
  test(`HTTP ${status} does not replace the working offline shell`, async () => {
    const sw = worker();
    const result = await sw.navigate(async () => html("error page", status));
    assert.equal(result.status, status);
    assert.equal(await sw.cachedText(), "working app shell");
    const offline = await sw.navigate(async () => { throw new TypeError("offline"); });
    assert.equal(await offline.text(), "working app shell");
    assert.equal(sw.writes, 0);
  });
}

for (const pathname of ["/remember/", "/remember/index.html", "/remember/index.html?view=list"]) {
  test(`a successful HTML app entry at ${pathname} refreshes the offline shell`, async () => {
    const sw = worker();
    const result = await sw.navigate(async () => html("updated app", 200, `https://example.test${pathname}`), pathname);
    assert.equal(await result.text(), "updated app");
    assert.equal(await sw.cachedText(), "updated app");
    assert.equal(sw.writes, 1);
  });
}

for (const [name, pathname, response] of [
  ["another HTML page", "/remember/help.html", () => html("help", 200, "https://example.test/remember/help.html")],
  ["a path outside the app", "/index.html", () => html("other app", 200, "https://example.test/index.html")],
  ["a JSON response", "/remember/index.html", () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } })],
  ["an authentication redirect", "/remember/", () => html("sign in", 200, "https://example.test/login", true)],
  ["a partial HTML response", "/remember/", () => html("partial app", 206, "https://example.test/remember/")],
]) {
  test(`${name} cannot poison the app entry cache`, async () => {
    const sw = worker();
    await sw.navigate(async () => response(), pathname);
    assert.equal(await sw.cachedText(), "working app shell");
    assert.equal(sw.writes, 0);
  });
}

test("cache storage failure still returns the successful online document", async () => {
  const sw = worker({ failWrite: true });
  const result = await sw.navigate(async () => html("online app"));
  assert.equal(await result.text(), "online app");
  assert.equal(await sw.cachedText(), "working app shell");
});

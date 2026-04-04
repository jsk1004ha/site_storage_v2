const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

function read(filePath) {
  return fs.readFileSync(path.join(rootDir, filePath), "utf8");
}

test("index.html keeps the core app surfaces required for navigation, saving, and sync", () => {
  const html = read("index.html");
  const requiredIds = [
    "sidePanel",
    "searchInput",
    "clearFiltersBtn",
    "cardsContainer",
    "suggestions",
    "bulkBar",
    "openSettingsBtn",
    "driveStatus",
    "saveCurrentTabBtn",
    "openSheetBtn",
    "sheetProgress",
    "actionDialogOverlay",
    "readerOverlay",
    "settingsOverlay"
  ];

  requiredIds.forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `expected #${id} to remain in index.html`);
  });

  assert.match(html, /data-view-mode="grid"/);
  assert.match(html, /data-view-mode="list"/);
  assert.match(html, /data-view-mode="magazine"/);
  assert.match(html, /Google Drive 동기화/);
});

test("service-worker.js keeps the offline app shell cache and navigation fallback", () => {
  const sw = read("service-worker.js");

  [
    "./",
    "./index.html",
    "./app-style.css",
    "./app.js",
    "./icons/site.webmanifest"
  ].forEach((asset) => {
    assert.match(sw, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  assert.match(sw, /event\.request\.mode === "navigate"/);
  assert.match(sw, /caches\.match\("\.\/index\.html"\)/);
  assert.match(sw, /cache\.put\("\.\/index\.html", cloned\)/);
});

test("manifest.json keeps extension entry points, commands, and required permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "extension/background.js");
  assert.equal(manifest.action.default_popup, "extension/popup.html");
  assert.equal(manifest.commands["save-current-tab"].description, "현재 활성 탭을 Remember에 저장");

  ["identity", "tabs", "storage", "alarms", "contextMenus"].forEach((permission) => {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission} permission`);
  });

  [
    "extension/popup.html",
    "extension/background.js",
    "icons/favicon-16x16.png",
    "icons/favicon-32x32.png"
  ].forEach((filePath) => {
    assert.ok(fs.existsSync(path.join(rootDir, filePath)), `${filePath} should exist`);
  });
});

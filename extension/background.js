/* global chrome */
"use strict";

const DATA_KEY = "rememberUnifiedDataV2";
const GOOGLE_CONFIG_KEY = "rememberGoogleConfigV1";
const GOOGLE_TOKEN_KEY = "rememberGoogleTokenV1";
const DRIVE_SYNC_CACHE_KEY = "rememberDriveSyncCacheV1";
const DRIVE_FILE_NAME = "remember-sync-v2.json";

const STORAGE_DB_NAME = "rememberDataStore";
const STORAGE_DB_VERSION = 1;
const STORAGE_STORE_NAME = "rememberKv";
const STORAGE_DATA_RECORD_KEY = "appData";

const AUTO_SYNC_MASS_DELETE_MIN_ITEMS = 8;
const AUTO_SYNC_MASS_DELETE_RATIO = 0.55;
const BG_ALARM_NAME = "rememberBackgroundSyncAlarm";
const BG_ALARM_PERIOD_MINUTES = 5;

const BG_SYNC_UPDATED_MESSAGE = "remember-bg-sync-updated";
const BG_SYNC_WARNING_MESSAGE = "remember-bg-sync-warning";
const CONTEXT_MENU_SAVE_PAGE = "remember-save-page";
const CONTEXT_MENU_SAVE_LINK = "remember-save-link";

let syncInFlight = false;
let dbPromise = null;

chrome.runtime.onInstalled.addListener(() => {
  ensureBackgroundAlarm();
  ensureContextMenus();
  runBackgroundSyncSafely();
});

chrome.runtime.onStartup.addListener(() => {
  ensureBackgroundAlarm();
  ensureContextMenus();
  runBackgroundSyncSafely();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BG_ALARM_NAME) {
    return;
  }
  runBackgroundSyncSafely();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "remember-bg-sync-now") {
    runBackgroundSyncSafely();
  }
});

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command !== "save-current-tab") {
      return;
    }
    saveActiveTabFromCommand().catch(() => {});
  });
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const menuId = String(info.menuItemId || "");
    if (menuId !== CONTEXT_MENU_SAVE_PAGE && menuId !== CONTEXT_MENU_SAVE_LINK) {
      return;
    }

    const candidateUrl =
      menuId === CONTEXT_MENU_SAVE_LINK
        ? info.linkUrl || ""
        : info.pageUrl || tab?.url || "";

    if (!candidateUrl) {
      return;
    }

    const titleCandidate =
      menuId === CONTEXT_MENU_SAVE_LINK
        ? info.selectionText || info.linkText || tab?.title || ""
        : tab?.title || "";

    addBookmarkFromContext(candidateUrl, titleCandidate, tab?.favIconUrl || "").catch(() => {});
  });
}

ensureBackgroundAlarm();
ensureContextMenus();

async function saveActiveTabFromCommand() {
  const tab = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0] || null);
    });
  });

  const url = tab?.url || "";
  if (!url || !normalizeUrl(url)) {
    return;
  }

  await addBookmarkFromContext(url, tab?.title || "", tab?.favIconUrl || "");
}

function ensureBackgroundAlarm() {
  chrome.alarms.create(BG_ALARM_NAME, {
    periodInMinutes: BG_ALARM_PERIOD_MINUTES
  });
}

function ensureContextMenus() {
  if (!chrome.contextMenus) {
    return;
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SAVE_PAGE,
      title: "Remember에 이 페이지 저장",
      contexts: ["page"]
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU_SAVE_LINK,
      title: "이 링크를 Remember에 저장",
      contexts: ["link"]
    });
  });
}

async function addBookmarkFromContext(url, title, faviconUrl) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return;
  }

  const data = normalizeData((await readDataFromIndexedDb()) || createEmptyData());
  const now = Date.now();
  const index = data.bookmarks.findIndex((item) => item.url === normalizedUrl);

  if (index >= 0) {
    data.bookmarks[index] = normalizeBookmark({
      ...data.bookmarks[index],
      updatedAt: now
    });
    data.updatedAt = now;
    await writeDataToIndexedDb(data);
    broadcast({ type: BG_SYNC_UPDATED_MESSAGE });
    broadcast({
      type: BG_SYNC_WARNING_MESSAGE,
      message: "이미 저장된 사이트입니다."
    });
    runBackgroundSyncSafely();
    return;
  }

  const name = String(title || "").trim() || extractDomain(normalizedUrl) || normalizedUrl;
  const newItem = normalizeBookmark({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    url: normalizedUrl,
    name,
    folder: "기본",
    thumbUrl: "",
    faviconUrl: normalizeAssetUrl(faviconUrl || "", normalizedUrl),
    tags: [],
    desc: "",
    createdAt: now,
    updatedAt: now,
    pinned: false,
    visitCount: 0,
    visitedAt: null,
    domain: extractDomain(normalizedUrl)
  });

  data.bookmarks.push(newItem);
  data.updatedAt = now;
  await writeDataToIndexedDb(data);
  broadcast({ type: BG_SYNC_UPDATED_MESSAGE });
  broadcast({
    type: BG_SYNC_WARNING_MESSAGE,
    message: "우클릭 메뉴로 사이트를 저장했습니다."
  });
  runBackgroundSyncSafely();
}

async function runBackgroundSyncSafely() {
  if (syncInFlight) {
    return;
  }

  syncInFlight = true;
  try {
    const result = await runBackgroundSync();
    if (result?.updated) {
      broadcast({ type: BG_SYNC_UPDATED_MESSAGE });
    } else if (result?.warning) {
      broadcast({
        type: BG_SYNC_WARNING_MESSAGE,
        message: result.warning
      });
    }
  } catch (_error) {
    // ignore in background; popup performs interactive recovery.
  } finally {
    syncInFlight = false;
  }
}

async function runBackgroundSync() {
  const state = await getStorageValues([
    GOOGLE_CONFIG_KEY,
    GOOGLE_TOKEN_KEY,
    DRIVE_SYNC_CACHE_KEY
  ]);

  const config = parseGoogleConfig(state[GOOGLE_CONFIG_KEY]);
  if (!config.clientId) {
    return { updated: false };
  }

  const token = parseGoogleToken(state[GOOGLE_TOKEN_KEY]);
  if (!token || token.expiresAt <= Date.now() + 15000) {
    await removeStorageKey(GOOGLE_TOKEN_KEY);
    return { updated: false };
  }

  const cache = parseDriveSyncCache(state[DRIVE_SYNC_CACHE_KEY]);
  const localData = normalizeData((await readDataFromIndexedDb()) || createEmptyData());

  let fileId = cache.fileId || "";
  let remoteData = null;

  if (fileId) {
    try {
      remoteData = await downloadDriveData(fileId, token.accessToken);
    } catch (error) {
      if (isDriveFileMissingError(error)) {
        fileId = "";
      } else {
        throw error;
      }
    }
  }

  if (!remoteData) {
    const remoteFile = await findDriveFile(token.accessToken);
    if (remoteFile?.id) {
      fileId = remoteFile.id;
      remoteData = await downloadDriveData(fileId, token.accessToken);
    }
  }

  const merged = remoteData ? mergeData(localData, remoteData) : localData;
  if (remoteData && shouldSkipAutoSyncForMassDeletion(localData, remoteData, merged)) {
    return {
      updated: false,
      warning:
        "백그라운드 동기화 안전모드: 대량 삭제 가능성이 감지되어 중단했습니다. 팝업에서 수동 동기화로 확인해주세요."
    };
  }

  merged.updatedAt = Date.now();
  await writeDataToIndexedDb(merged);

  const uploaded = await uploadDriveData(merged, fileId || null, token.accessToken);
  if (!uploaded?.id) {
    return { updated: false };
  }

  const now = Date.now();
  await setStorageValues({
    [DRIVE_SYNC_CACHE_KEY]: JSON.stringify({
      fileId: uploaded.id,
      lastFullSyncAt: now,
      lastFastSyncAt: now
    })
  });

  return { updated: true };
}

function getStorageValues(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => {
      resolve(items || {});
    });
  });
}

function setStorageValues(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

function removeStorageKey(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, () => resolve());
  });
}

function broadcast(payload) {
  chrome.runtime.sendMessage(payload, () => {
    void chrome.runtime.lastError;
  });
}

function parseGoogleConfig(raw) {
  if (!raw || typeof raw !== "string") {
    return { clientId: "" };
  }
  try {
    const parsed = JSON.parse(raw);
    return { clientId: String(parsed.clientId || "").trim() };
  } catch (_error) {
    return { clientId: "" };
  }
}

function parseGoogleToken(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const accessToken = String(parsed.accessToken || "").trim();
    const expiresAt = toSafeNumber(parsed.expiresAt, 0);
    if (!accessToken || !expiresAt) {
      return null;
    }
    return { accessToken, expiresAt };
  } catch (_error) {
    return null;
  }
}

function parseDriveSyncCache(raw) {
  if (!raw || typeof raw !== "string") {
    return { fileId: "", lastFullSyncAt: 0, lastFastSyncAt: 0 };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      fileId: String(parsed.fileId || "").trim(),
      lastFullSyncAt: toSafeNumber(parsed.lastFullSyncAt, 0),
      lastFastSyncAt: toSafeNumber(parsed.lastFastSyncAt, 0)
    };
  } catch (_error) {
    return { fileId: "", lastFullSyncAt: 0, lastFastSyncAt: 0 };
  }
}

function toSafeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createEmptyData() {
  return {
    version: 2,
    updatedAt: Date.now(),
    bookmarks: [],
    tombstones: []
  };
}

function normalizeFolderName(value) {
  const folder = String(value || "").trim();
  return folder || "기본";
}

function normalizeUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeAssetUrl(url, baseUrl = "") {
  const raw = String(url || "").trim();
  if (!raw) {
    return "";
  }

  if (/^data:/i.test(raw)) {
    return raw;
  }

  try {
    const parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function parseTags(input) {
  if (!input) {
    return [];
  }

  return input
    .split(/[ ,]+/)
    .map((tag) => tag.trim())
    .filter((tag, index, list) => tag && list.indexOf(tag) === index);
}

function normalizeLinkHealth(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const checkedAt = toSafeNumber(value.checkedAt, 0);
  const status = toSafeNumber(value.status, 0);
  if (!checkedAt) {
    return null;
  }
  return {
    checkedAt,
    status: status > 0 ? status : 0,
    broken: !!value.broken
  };
}

function normalizeBookmark(value) {
  const item = value && typeof value === "object" ? value : {};
  const normalizedUrl = normalizeUrl(String(item.url || "").trim());
  const createdAt = toSafeNumber(item.createdAt, Date.now());
  const updatedAt = toSafeNumber(item.updatedAt, createdAt);

  return {
    id: String(item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
    url: normalizedUrl || "",
    name: String(item.name || normalizedUrl || ""),
    folder: normalizeFolderName(item.folder),
    thumbUrl: normalizeAssetUrl(item.thumbUrl, normalizedUrl || ""),
    faviconUrl: normalizeAssetUrl(item.faviconUrl, normalizedUrl || ""),
    tags: parseTags(Array.isArray(item.tags) ? item.tags.join(" ") : String(item.tags || "")),
    desc: String(item.desc || ""),
    createdAt,
    updatedAt,
    pinned: !!item.pinned,
    visitCount: toSafeNumber(item.visitCount, 0),
    visitedAt: item.visitedAt ? toSafeNumber(item.visitedAt, null) : null,
    domain: extractDomain(normalizedUrl || ""),
    reader: item.reader && typeof item.reader === "object" ? item.reader : null,
    linkHealth: normalizeLinkHealth(item.linkHealth)
  };
}

function normalizeData(raw) {
  let source = raw;
  if (!source || typeof source !== "object") {
    source = {};
  }
  if (Array.isArray(source)) {
    source = { version: 1, bookmarks: source };
  }

  const rawBookmarks = Array.isArray(source.bookmarks) ? source.bookmarks : [];
  const bookmarkMap = new Map();
  rawBookmarks.forEach((entry) => {
    const normalized = normalizeBookmark(entry);
    if (!normalized.url) {
      return;
    }
    const existing = bookmarkMap.get(normalized.id);
    if (!existing || normalized.updatedAt > existing.updatedAt) {
      bookmarkMap.set(normalized.id, normalized);
    }
  });

  const tombstoneMap = new Map();
  const rawTombstones = Array.isArray(source.tombstones) ? source.tombstones : [];
  rawTombstones.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const id = String(entry.id || "").trim();
    if (!id) {
      return;
    }
    const deletedAt = toSafeNumber(entry.deletedAt, Date.now());
    const previous = tombstoneMap.get(id);
    if (!previous || deletedAt > previous.deletedAt) {
      tombstoneMap.set(id, { id, deletedAt });
    }
  });

  const bookmarks = [];
  bookmarkMap.forEach((bookmark) => {
    const tombstone = tombstoneMap.get(bookmark.id);
    if (tombstone && tombstone.deletedAt >= bookmark.updatedAt) {
      return;
    }
    bookmarks.push(bookmark);
  });

  const tombstones = [];
  tombstoneMap.forEach((tombstone) => {
    const bookmark = bookmarkMap.get(tombstone.id);
    if (bookmark && bookmark.updatedAt > tombstone.deletedAt) {
      return;
    }
    tombstones.push(tombstone);
  });

  tombstones.sort((a, b) => b.deletedAt - a.deletedAt);

  return {
    version: 2,
    updatedAt: toSafeNumber(source.updatedAt, Date.now()),
    bookmarks,
    tombstones: tombstones.slice(0, 500)
  };
}

function mergeData(localData, remoteData) {
  const local = normalizeData(localData);
  const remote = normalizeData(remoteData);

  const localBookmarks = new Map(local.bookmarks.map((item) => [item.id, item]));
  const remoteBookmarks = new Map(remote.bookmarks.map((item) => [item.id, item]));
  const localTombstones = new Map(local.tombstones.map((item) => [item.id, item]));
  const remoteTombstones = new Map(remote.tombstones.map((item) => [item.id, item]));

  const allIds = new Set([
    ...localBookmarks.keys(),
    ...remoteBookmarks.keys(),
    ...localTombstones.keys(),
    ...remoteTombstones.keys()
  ]);

  const merged = {
    version: 2,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    bookmarks: [],
    tombstones: []
  };

  allIds.forEach((id) => {
    const localBookmark = localBookmarks.get(id);
    const remoteBookmark = remoteBookmarks.get(id);
    const localTombstone = localTombstones.get(id);
    const remoteTombstone = remoteTombstones.get(id);

    const winnerBookmark = pickNewerBookmark(localBookmark, remoteBookmark);
    const winnerTombstone = pickNewerTombstone(localTombstone, remoteTombstone);

    const bookmarkTime = winnerBookmark ? winnerBookmark.updatedAt : -1;
    const tombstoneTime = winnerTombstone ? winnerTombstone.deletedAt : -1;

    if (winnerBookmark && bookmarkTime > tombstoneTime) {
      merged.bookmarks.push(winnerBookmark);
    } else if (winnerTombstone) {
      merged.tombstones.push(winnerTombstone);
    }
  });

  merged.tombstones.sort((a, b) => b.deletedAt - a.deletedAt);
  merged.tombstones = merged.tombstones.slice(0, 500);
  return normalizeData(merged);
}

function pickNewerBookmark(a, b) {
  if (!a) {
    return b || null;
  }
  if (!b) {
    return a;
  }
  return a.updatedAt >= b.updatedAt ? a : b;
}

function pickNewerTombstone(a, b) {
  if (!a) {
    return b || null;
  }
  if (!b) {
    return a;
  }
  return a.deletedAt >= b.deletedAt ? a : b;
}

function shouldSkipAutoSyncForMassDeletion(localData, remoteData, mergedData) {
  const localCount = Array.isArray(localData?.bookmarks) ? localData.bookmarks.length : 0;
  const remoteCount = Array.isArray(remoteData?.bookmarks) ? remoteData.bookmarks.length : 0;
  const mergedCount = Array.isArray(mergedData?.bookmarks) ? mergedData.bookmarks.length : 0;

  const baseline = Math.max(localCount, remoteCount);
  if (baseline < AUTO_SYNC_MASS_DELETE_MIN_ITEMS) {
    return false;
  }

  const removedFromLocal = localCount - mergedCount;
  const removedFromRemote = remoteCount - mergedCount;
  if (removedFromLocal <= 0 && removedFromRemote <= 0) {
    return false;
  }

  return mergedCount <= Math.floor(baseline * AUTO_SYNC_MASS_DELETE_RATIO);
}

async function openStorageDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DB_NAME, STORAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORAGE_STORE_NAME)) {
        db.createObjectStore(STORAGE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB 초기화 실패"));
  });

  return dbPromise;
}

async function readDataFromIndexedDb() {
  const db = await openStorageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORAGE_STORE_NAME, "readonly");
    const store = tx.objectStore(STORAGE_STORE_NAME);
    const request = store.get(STORAGE_DATA_RECORD_KEY);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("IndexedDB 읽기 실패"));
  });
}

async function writeDataToIndexedDb(data) {
  const db = await openStorageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORAGE_STORE_NAME, "readwrite");
    const store = tx.objectStore(STORAGE_STORE_NAME);
    const request = store.put(normalizeData(data), STORAGE_DATA_RECORD_KEY);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error("IndexedDB 쓰기 실패"));
  });
}

async function driveFetch(url, accessToken, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    await removeStorageKey(GOOGLE_TOKEN_KEY);
    throw new Error("Google 로그인이 필요합니다");
  }

  if (!response.ok) {
    const text = await response.text();
    const message = text || `HTTP ${response.status}`;
    throw new Error(`Drive API 오류: ${message}`);
  }

  return response;
}

async function findDriveFile(accessToken) {
  const query = encodeURIComponent(
    `name='${DRIVE_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=1`;
  const response = await driveFetch(url, accessToken, { method: "GET" });
  const payload = await response.json();
  return payload.files?.[0] || null;
}

async function downloadDriveData(fileId, accessToken) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await driveFetch(url, accessToken, { method: "GET" });
  return normalizeData(await response.json());
}

async function uploadDriveData(data, fileId, accessToken) {
  const boundary = "rememberBoundary" + Date.now();
  const metadata = fileId
    ? { name: DRIVE_FILE_NAME }
    : { name: DRIVE_FILE_NAME, parents: ["appDataFolder"] };

  const multipartBody =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(normalizeData(data))}\r\n` +
    `--${boundary}--`;

  const method = fileId ? "PATCH" : "POST";
  const endpoint = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,modifiedTime`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime";

  const response = await driveFetch(endpoint, accessToken, {
    method,
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body: multipartBody
  });

  return response.json();
}

function isDriveFileMissingError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes("HTTP 404") ||
    message.includes("notFound") ||
    message.includes("File not found")
  );
}

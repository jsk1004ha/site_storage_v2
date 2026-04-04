const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_ENTRY_GUARD = /  if \(\r?\n    !searchInput \|\|\r?\n    !sortSelect \|\|\r?\n    !cardsContainer \|\|\r?\n    !tagFiltersDiv \|\|\r?\n    !suggestionsDiv\r?\n  \) \{\r?\n    return;\r?\n  \}\r?\n/;

const TEST_EXPORT_REPLACEMENT = `  globalThis.__rememberTestExports = {
    parseTags,
    normalizeFolderName,
    normalizeUrl,
    normalizeAssetUrl,
    extractDomain,
    normalizeLinkHealth,
    normalizeBookmark,
    normalizeData,
    mergeData,
    pickNewerBookmark,
    pickNewerTombstone,
    toSafeNumber
  };
  return;
`;

function createContext() {
  const noop = () => {};
  const localStorage = new Map();
  const context = {
    URL,
    URLSearchParams,
    console,
    Date,
    Map,
    Math,
    Set,
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
    structuredClone: global.structuredClone,
    window: {
      addEventListener: noop,
      close: noop,
      location: {
        hash: "",
        origin: "https://remember.test",
        protocol: "https:",
        search: ""
      },
      matchMedia: () => ({
        matches: false,
        addEventListener: noop,
        removeEventListener: noop
      }),
      opener: null
    },
    document: {
      body: {
        dataset: {
          appContext: "web"
        }
      },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    localStorage: {
      getItem(key) {
        return localStorage.has(key) ? localStorage.get(key) : null;
      },
      setItem(key, value) {
        localStorage.set(key, String(value));
      },
      removeItem(key) {
        localStorage.delete(key);
      }
    }
  };

  context.globalThis = context;
  return context;
}

function loadAppExports() {
  const appPath = path.resolve(__dirname, "..", "..", "app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const instrumented = source.replace(APP_ENTRY_GUARD, TEST_EXPORT_REPLACEMENT);

  if (instrumented === source) {
    throw new Error("Failed to instrument app.js for test exports");
  }

  const context = createContext();
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: appPath });

  if (!context.__rememberTestExports) {
    throw new Error("app.js did not expose test exports");
  }

  return context.__rememberTestExports;
}

module.exports = {
  loadAppExports
};

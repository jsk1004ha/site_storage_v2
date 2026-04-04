
(() => {
  "use strict";

  const APP_CONTEXT = document.body?.dataset?.appContext || "web";
  const IS_EXTENSION_RUNTIME =
    typeof chrome !== "undefined" &&
    !!chrome.runtime?.id &&
    !!chrome.identity?.launchWebAuthFlow;
  const IS_EXTENSION_CONTEXT = APP_CONTEXT === "extension" || IS_EXTENSION_RUNTIME;

  if (handleOAuthCallbackPage()) {
    return;
  }

  const DATA_KEY = "rememberUnifiedDataV2";
  const VIEW_MODE_KEY = "rememberViewModeV1";
  const THEME_KEY = "rememberThemePresetV2";
  const LEGACY_THEME_KEY = "rememberThemeV1";
  const FOLDER_COLLAPSE_KEY = "rememberFolderCollapseV1";
  const FOLDER_META_KEY = "rememberFolderMetaV1";
  const THEME_PRESET_DEEP_OCEAN = "deep-ocean";
  const THEME_PRESET_GLACIER = "glacier";
  const THEME_PRESET_SOLARIS = "solaris";
  const GOOGLE_CONFIG_KEY = "rememberGoogleConfigV1";
  const GOOGLE_TOKEN_KEY = "rememberGoogleTokenV1";
  const DRIVE_SYNC_CACHE_KEY = "rememberDriveSyncCacheV1";
  const DEFAULT_FOLDER_NAME = "기본";
  const AUTO_SYNC_DELAY_MS = 600;
  const AUTO_SYNC_ERROR_COOLDOWN_MS = 15000;
  const AUTO_SYNC_MASS_DELETE_MIN_ITEMS = 8;
  const AUTO_SYNC_MASS_DELETE_RATIO = 0.55;
  const AUTO_SYNC_FULL_RECONCILE_MS = 45000;
  const STORAGE_DB_NAME = "rememberDataStore";
  const STORAGE_DB_VERSION = 1;
  const STORAGE_STORE_NAME = "rememberKv";
  const STORAGE_DATA_RECORD_KEY = "appData";
  const RENDER_BATCH_SIZE = 30;
  const BG_SYNC_UPDATED_MESSAGE = "remember-bg-sync-updated";
  const BG_SYNC_WARNING_MESSAGE = "remember-bg-sync-warning";
  const LINK_CHECK_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const LINK_CHECK_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
  const LINK_CHECK_BATCH_SIZE = 4;

  const DRIVE_FILE_NAME = "remember-sync-v2.json";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const GOOGLE_TOKEN_DURATION_DAY = "1d";
  const GOOGLE_TOKEN_DURATION_WEEK = "1w";
  const GOOGLE_TOKEN_DURATION_MONTH = "1m";
  const GOOGLE_TOKEN_DURATION_QUARTER = "3m";
  const GOOGLE_TOKEN_DURATION_YEAR = "1y";
  const GOOGLE_TOKEN_DURATION_DEFAULT = GOOGLE_TOKEN_DURATION_WEEK;
  const GOOGLE_TOKEN_DURATION_MS = {
    [GOOGLE_TOKEN_DURATION_DAY]: 24 * 60 * 60 * 1000,
    [GOOGLE_TOKEN_DURATION_WEEK]: 7 * 24 * 60 * 60 * 1000,
    [GOOGLE_TOKEN_DURATION_MONTH]: 30 * 24 * 60 * 60 * 1000,
    [GOOGLE_TOKEN_DURATION_QUARTER]: 90 * 24 * 60 * 60 * 1000,
    [GOOGLE_TOKEN_DURATION_YEAR]: 365 * 24 * 60 * 60 * 1000
  };

  let selectedTags = [];
  let selectedFolder = "";
  let currentFacetPane = "folders";
  let tagSearchKeyword = "";
  let collapsedFolderPaths = new Set();
  let currentSort = "recentAdd";
  let currentViewMode = "grid";
  let currentAppTab = "dashboard";
  let themePreset = THEME_PRESET_DEEP_OCEAN;
  let deletedItem = null;
  let undoTimeout = null;
  let editId = null;
  let sheetMode = "add";
  let smartFilter = "";
  let metadataRequestInFlight = 0;
  let syncInFlight = false;
  let autoSyncTimer = null;
  let autoSyncPending = false;
  let autoSyncForceFull = false;
  let lastAutoSyncErrorAt = 0;
  let dataCache = normalizeData({
    version: 2,
    updatedAt: Date.now(),
    bookmarks: [],
    tombstones: []
  });
  let selectedBookmarkIds = new Set();
  let keyboardFocusedCardIndex = -1;
  let storageDbPromise = null;
  let persistQueue = Promise.resolve();
  let currentRenderItems = [];
  let renderedBookmarkCount = 0;
  let cardsObserver = null;
  let cardsSentinel = null;
  let lastStoragePersistErrorAt = 0;
  let draggingBookmarkIds = [];
  let extensionRuntimeListenerBound = false;
  let sheetTagTokens = [];
  let deadLinkCheckScheduled = false;
  let deadLinkCheckInFlight = false;
  let folderMetaMap = {};
  let lastScrollY = 0;
  let ctaHiddenByScroll = false;
  let pendingActionDialog = null;

  const searchInput = byId("searchInput");
  const sortSelect = byId("sortSelect");
  const folderFilterSelect = byId("folderFilterSelect");
  const sidePanel = byId("sidePanel");
  const sideBackdrop = byId("sideBackdrop");
  const openSidePanelBtn = byId("openSidePanelBtn");
  const closeSidePanelBtn = byId("closeSidePanelBtn");
  const showFolderPaneBtn = byId("showFolderPaneBtn");
  const showTagPaneBtn = byId("showTagPaneBtn");
  const foldersPane = byId("foldersPane");
  const tagsPane = byId("tagsPane");
  const closeTagPaneBtn = byId("closeTagPaneBtn");
  const tagPaneBackdrop = byId("tagPaneBackdrop");
  const tagSearchInput = byId("tagSearchInput");
  const folderFiltersDiv = byId("folderFilters");
  const viewToggleButtons = Array.from(document.querySelectorAll("[data-view-mode]"));
  const cardsContainer = byId("cardsContainer");
  const bulkBar = byId("bulkBar");
  const bulkCount = byId("bulkCount");
  const bulkToggleVisibleBtn = byId("bulkToggleVisibleBtn");
  const bulkMoveFolderBtn = byId("bulkMoveFolderBtn");
  const bulkAddTagBtn = byId("bulkAddTagBtn");
  const bulkRemoveTagBtn = byId("bulkRemoveTagBtn");
  const bulkDeleteBtn = byId("bulkDeleteBtn");
  const bulkClearBtn = byId("bulkClearBtn");
  const tagFiltersDiv = byId("tagFilters");
  const suggestionsDiv = byId("suggestions");
  const sheetOverlay = byId("sheetOverlay");
  const sheet = byId("sheet");
  const sheetTitle = byId("sheetTitle");
  const step1 = byId("step1");
  const step2 = byId("step2");
  const siteUrlInput = byId("siteUrl");
  const siteNameInput = byId("siteName");
  const siteFolderInput = byId("siteFolder");
  const siteThumbUrlInput = byId("siteThumbUrl");
  const siteFaviconUrlInput = byId("siteFaviconUrl");
  const siteTagsChipBox = byId("siteTagsChipBox");
  const siteTagsEditor = byId("siteTagsEditor");
  const siteTagsInput = byId("siteTags");
  const siteDescInput = byId("siteDesc");
  const metadataPreview = byId("metadataPreview");
  const metadataThumb = byId("metadataThumb");
  const metadataFavicon = byId("metadataFavicon");
  const metadataDomain = byId("metadataDomain");
  const metadataDescription = byId("metadataDescription");
  const metadataSkeleton = byId("metadataSkeleton");
  const metadataHint = byId("metadataHint");
  const folderSuggestions = byId("folderSuggestions");
  const tagSuggestions = byId("tagSuggestions");
  const folderStyleTarget = byId("folderStyleTarget");
  const folderEmojiInput = byId("folderEmojiInput");
  const folderColorInput = byId("folderColorInput");
  const saveFolderStyleBtn = byId("saveFolderStyleBtn");
  const clearFolderStyleBtn = byId("clearFolderStyleBtn");
  const cancelBtn1 = byId("cancelBtn1");
  const nextBtn = byId("nextBtn");
  const backBtn = byId("backBtn");
  const saveBtn = byId("saveBtn");
  const openSheetBtn = byId("openSheetBtn");
  const toastContainer = byId("toastContainer");
  const exportBtn = byId("exportBtn");
  const importBtn = byId("importBtn");
  const checkDeadLinksBtn = byId("checkDeadLinksBtn");
  const deleteBrokenLinksBtn = byId("deleteBrokenLinksBtn");
  const importFileInput = byId("importFile");
  const bookmarkletBtn = byId("bookmarkletBtn");
  const saveCurrentTabBtn = byId("saveCurrentTabBtn");
  const scrollTopBtn = byId("scrollTopBtn");
  const bottomUtils = document.querySelector(".bottom-utils");
  const bottomCta = openSheetBtn?.closest(".bottom-cta") || null;
  const settingsOverlay = byId("settingsOverlay");
  const openSettingsBtn = byId("openSettingsBtn");
  const sidebarSettingsBtn = byId("sidebarSettingsBtn");
  const closeSettingsBtn = byId("closeSettingsBtn");
  const themeModeHint = byId("themeModeHint");
  const themeModeButtons = Array.from(document.querySelectorAll("[data-theme-preset]"));
  const topbarAddSiteBtn = byId("topbarAddSiteBtn");
  const heroAddSiteBtn = byId("heroAddSiteBtn");
  const heroFocusSearchBtn = byId("heroFocusSearchBtn");
  const heroOpenSettingsBtn = byId("heroOpenSettingsBtn");
  const heroBackupBtn = byId("heroBackupBtn");
  const heroDriveActionBtn = byId("heroDriveActionBtn");
  const heroCheckLinksBtn = byId("heroCheckLinksBtn");
  const heroOpenSettingsPanelBtn = byId("heroOpenSettingsPanelBtn");
  const heroOpenSettingsPanelBtnSecondary = byId("heroOpenSettingsPanelBtnSecondary");
  const heroBookmarkCount = byId("heroBookmarkCount");
  const heroFolderCount = byId("heroFolderCount");
  const heroTagCount = byId("heroTagCount");
  const heroSyncStatus = byId("heroSyncStatus");
  const heroSyncDetail = byId("heroSyncDetail");
  const heroSelectionCount = byId("heroSelectionCount");
  const resultsCountLabel = byId("resultsCountLabel");
  const resultsContextLabel = byId("resultsContextLabel");
  const activeViewBadge = byId("activeViewBadge");
  const activeFiltersBar = byId("activeFiltersBar");
  const workspacePresetButtons = Array.from(
    document.querySelectorAll("[data-workspace-preset]")
  );
  const searchShortcutButtons = Array.from(document.querySelectorAll("[data-search-snippet]"));
  const clearFiltersBtn = byId("clearFiltersBtn");
  const bulkSelectionHint = byId("bulkSelectionHint");
  const bulkFolderInput = byId("bulkFolderInput");
  const bulkTagsInput = byId("bulkTagsInput");
  const appTabButtons = Array.from(document.querySelectorAll("[data-app-tab]"));
  const dashboardView = byId("dashboardView");
  const readerTabView = byId("readerTabView");
  const statsTabView = byId("statsTabView");
  const readerTabList = byId("readerTabList");
  const readerTabCount = byId("readerTabCount");
  const statsBookmarkCount = byId("statsBookmarkCount");
  const statsFolderCount = byId("statsFolderCount");
  const statsTagCount = byId("statsTagCount");
  const statsReaderCount = byId("statsReaderCount");
  const statsTopFolders = byId("statsTopFolders");
  const statsTopTags = byId("statsTopTags");
  const statsUpdatedLabel = byId("statsUpdatedLabel");
  const sheetProgress = byId("sheetProgress");
  const actionDialogOverlay = byId("actionDialogOverlay");
  const actionDialogEyebrow = byId("actionDialogEyebrow");
  const actionDialogTitle = byId("actionDialogTitle");
  const actionDialogDescription = byId("actionDialogDescription");
  const actionDialogLabel = byId("actionDialogLabel");
  const actionDialogInput = byId("actionDialogInput");
  const actionDialogSummary = byId("actionDialogSummary");
  const actionDialogCloseBtn = byId("actionDialogCloseBtn");
  const actionDialogCancelBtn = byId("actionDialogCancelBtn");
  const actionDialogConfirmBtn = byId("actionDialogConfirmBtn");

  const readerOverlay = byId("readerOverlay");
  const readerCloseBtn = byId("readerCloseBtn");
  const readerOpenOriginal = byId("readerOpenOriginal");
  const readerTitle = byId("readerTitle");
  const readerSubline = byId("readerSubline");
  const readerImages = byId("readerImages");
  const readerBody = byId("readerBody");

  const driveStatusEl = byId("driveStatus");
  const driveConnectBtn = byId("driveConnectBtn");
  const driveSyncBtn = byId("driveSyncBtn");
  const drivePushBtn = byId("drivePushBtn");
  const drivePullBtn = byId("drivePullBtn");
  const googleClientIdInput = byId("googleClientIdInput");
  const googleTokenDurationSelect = byId("googleTokenDurationSelect");
  const saveGoogleConfigBtn = byId("saveGoogleConfigBtn");
  const clearGoogleConfigBtn = byId("clearGoogleConfigBtn");

  if (
    !searchInput ||
    !sortSelect ||
    !cardsContainer ||
    !tagFiltersDiv ||
    !suggestionsDiv
  ) {
    return;
  }

  initializeApp().catch((error) => {
    console.error("[remember] 초기화 오류", error);
    showToast("초기화 중 문제가 발생했습니다. 페이지를 새로고침해 주세요");
  });

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function registerWebServiceWorker() {
    const protocol = String(window.location?.protocol || "").toLowerCase();
    if (
      IS_EXTENSION_CONTEXT ||
      !("serviceWorker" in navigator) ||
      (protocol !== "http:" && protocol !== "https:")
    ) {
      return;
    }

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  function registerWebManifestLink() {
    const protocol = String(window.location?.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return;
    }

    const existingManifest = document.querySelector('link[rel="manifest"]');
    if (existingManifest) {
      return;
    }

    const manifestLink = document.createElement("link");
    manifestLink.rel = "manifest";
    manifestLink.href = "icons/site.webmanifest";
    document.head.appendChild(manifestLink);
  }

  function updateScrollTopButtonVisibility() {
    if (!scrollTopBtn) {
      return;
    }
    scrollTopBtn.hidden = window.scrollY < 420;
  }

  function isCompactDeviceLayout() {
    if (APP_CONTEXT === "extension") {
      return true;
    }
    return window.matchMedia("(max-width: 640px)").matches;
  }

  function updateFloatingCtaVisibility() {
    if (!bottomCta && !bottomUtils) {
      return;
    }

    const compact = isCompactDeviceLayout();
    const nextHidden = compact && ctaHiddenByScroll;
    bottomCta?.classList.toggle("is-hidden", nextHidden);
    if (APP_CONTEXT === "extension") {
      bottomUtils?.classList.toggle("is-hidden", nextHidden);
    }
    openSheetBtn?.classList.toggle("fab", compact);
    saveCurrentTabBtn?.classList.remove("fab-side");
    if (openSheetBtn) {
      openSheetBtn.setAttribute("aria-label", "새 사이트 추가");
    }
  }

  async function initializeApp() {
    registerWebManifestLink();
    registerWebServiceWorker();
    loadUiPreferences();
    applyTheme();
    updateThemePresetControls();
    applyViewModeClass();
    updateViewToggleButtons();
    setFacetPane(currentFacetPane);
    await hydrateDataCache();
    await bootstrapExtensionStorageMirror();
    bindExtensionRuntimeListeners();
    bindUiEvents();
    loadSavedGoogleConfig();
    refreshDriveStatus();
    initializeTagChipInput();
    render();
    checkIncomingUrl();
    scheduleAutoSync({ immediate: true, fullReconcile: true });
    scheduleDeadLinkCheck();
    lastScrollY = Math.max(window.scrollY || 0, 0);
    updateScrollTopButtonVisibility();
    updateFloatingCtaVisibility();
  }

  function loadUiPreferences() {
    const savedMode = localStorage.getItem(VIEW_MODE_KEY);
    if (savedMode === "grid" || savedMode === "list" || savedMode === "magazine") {
      currentViewMode = savedMode;
    }

    const savedTheme = String(
      localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY) || ""
    ).trim();
    if (isKnownThemePreset(savedTheme)) {
      themePreset = savedTheme;
    } else if (savedTheme === "light") {
      themePreset = THEME_PRESET_SOLARIS;
    } else if (savedTheme === "dark" || savedTheme === "auto" || savedTheme === "true") {
      themePreset = THEME_PRESET_DEEP_OCEAN;
    } else {
      themePreset = THEME_PRESET_DEEP_OCEAN;
    }

    try {
      const rawCollapsed = localStorage.getItem(FOLDER_COLLAPSE_KEY);
      if (rawCollapsed) {
        const parsed = JSON.parse(rawCollapsed);
        if (Array.isArray(parsed)) {
          collapsedFolderPaths = new Set(
            parsed
              .map((path) => normalizeFolderName(path))
              .filter((path) => path && path !== DEFAULT_FOLDER_NAME)
          );
        }
      }
    } catch (_error) {
      collapsedFolderPaths = new Set();
    }

    try {
      const rawMeta = localStorage.getItem(FOLDER_META_KEY);
      if (rawMeta) {
        folderMetaMap = normalizeFolderMetaMap(JSON.parse(rawMeta));
      } else {
        folderMetaMap = {};
      }
    } catch (_error) {
      folderMetaMap = {};
    }
  }

  function saveViewMode(mode) {
    currentViewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
    applyViewModeClass();
    updateViewToggleButtons();
    renderBookmarks();
  }

  function applyViewModeClass() {
    if (!cardsContainer) {
      return;
    }
    cardsContainer.classList.remove("view-grid", "view-list", "view-magazine");
    cardsContainer.classList.add(`view-${currentViewMode}`);
  }

  function updateViewToggleButtons() {
    viewToggleButtons.forEach((button) => {
      const mode = button.dataset.viewMode;
      button.classList.toggle("active", mode === currentViewMode);
    });
  }

  function getViewModeLabel(mode) {
    if (mode === "grid") {
      return "그리드 보기";
    }
    if (mode === "list") {
      return "리스트 보기";
    }
    return "매거진 보기";
  }

  function getSortLabel(mode) {
    if (mode === "recentVisit") {
      return "최근 방문";
    }
    if (mode === "frequent") {
      return "자주 방문";
    }
    return "최근 추가";
  }

  function getSmartFilterLabel(mode) {
    if (mode === "stale30") {
      return "30일 이상 안 본";
    }
    return "";
  }

  function getLatestSyncAt() {
    const cache = getDriveSyncCache();
    return Math.max(cache.lastFullSyncAt || 0, cache.lastFastSyncAt || 0);
  }

  function formatRelativeTime(timestamp) {
    const safeTimestamp = toSafeNumber(timestamp, 0);
    if (!safeTimestamp) {
      return "최근 동기화 기록 없음";
    }

    const elapsedMs = Math.max(0, Date.now() - safeTimestamp);
    const minutes = Math.floor(elapsedMs / (60 * 1000));
    if (minutes < 1) {
      return "방금 전";
    }
    if (minutes < 60) {
      return `${minutes}분 전`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}시간 전`;
    }

    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days}일 전`;
    }

    return new Date(safeTimestamp).toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric"
    });
  }

  function applyWorkspacePreset(mode) {
    smartFilter = mode === "stale30" ? "stale30" : "";
    searchInput.value = "";
    selectedTags = [];
    selectedFolder = "";
    currentSort =
      mode === "recentVisit" ? "recentVisit" : mode === "frequent" ? "frequent" : "recentAdd";
    sortSelect.value = currentSort;
    renderBookmarks();
    renderTagFilters();
    renderFolderFilters();
    closeSidePanelOnCompact();
  }

  function resetCollectionFilters(options = {}) {
    const keepQuery = !!options.keepQuery;
    if (!keepQuery) {
      searchInput.value = "";
    }
    smartFilter = "";
    selectedTags = [];
    selectedFolder = "";
    currentSort = "recentAdd";
    sortSelect.value = currentSort;
    if (folderFilterSelect) {
      folderFilterSelect.value = "";
    }
    tagSearchKeyword = "";
    if (tagSearchInput) {
      tagSearchInput.value = "";
    }
    renderBookmarks();
    renderTagFilters();
    renderFolderFilters();
    closeSidePanelOnCompact();
  }

  function insertSearchSnippet(snippet) {
    const safeSnippet = String(snippet || "").trim();
    if (!safeSnippet) {
      return;
    }
    const currentValue = (searchInput.value || "").trim();
    searchInput.value = currentValue ? `${currentValue} ${safeSnippet}` : safeSnippet;
    smartFilter = "";
    renderBookmarks();
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  function renderActiveFilters() {
    if (!activeFiltersBar) {
      return;
    }

    const filters = [];
    const query = (searchInput?.value || "").trim();
    if (query) {
      filters.push({ type: "query", label: "검색", value: query });
    }
    if (selectedFolder) {
      filters.push({ type: "folder", label: "폴더", value: selectedFolder });
    }
    selectedTags.forEach((tag) => {
      filters.push({ type: "tag", label: "태그", value: tag });
    });
    if (smartFilter) {
      filters.push({
        type: "smartFilter",
        label: "스마트 뷰",
        value: getSmartFilterLabel(smartFilter) || smartFilter
      });
    } else if (currentSort !== "recentAdd") {
      filters.push({ type: "sort", label: "정렬", value: getSortLabel(currentSort) });
    }

    if (!filters.length) {
      activeFiltersBar.hidden = true;
      activeFiltersBar.innerHTML = "";
      return;
    }

    activeFiltersBar.hidden = false;
    activeFiltersBar.innerHTML = "";

    const label = document.createElement("span");
    label.className = "active-filters-label";
    label.textContent = "현재 필터";
    activeFiltersBar.appendChild(label);

    const list = document.createElement("div");
    list.className = "active-filter-list";

    filters.forEach((filter) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "active-filter-chip";
      chip.innerHTML = `<strong>${escapeHtml(filter.label)}</strong><span>${escapeHtml(filter.value)}</span><span aria-hidden="true">×</span>`;
      chip.addEventListener("click", () => {
        if (filter.type === "query" && searchInput) {
          searchInput.value = "";
        } else if (filter.type === "folder") {
          selectedFolder = "";
          if (folderFilterSelect) {
            folderFilterSelect.value = "";
          }
          renderFolderFilters();
        } else if (filter.type === "tag") {
          selectedTags = selectedTags.filter((tag) => tag !== filter.value);
          renderTagFilters();
        } else if (filter.type === "smartFilter") {
          smartFilter = "";
        } else if (filter.type === "sort") {
          currentSort = "recentAdd";
          sortSelect.value = currentSort;
        }
        renderBookmarks();
      });
      list.appendChild(chip);
    });

    activeFiltersBar.appendChild(list);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "active-filters-clear";
    clearButton.textContent = "모두 지우기";
    clearButton.addEventListener("click", () => {
      resetCollectionFilters();
    });
    activeFiltersBar.appendChild(clearButton);
  }

  function updateWorkspaceSummary(visibleCount = currentRenderItems.length) {
    const bookmarks = getBookmarks();
    const folderCount = new Set(
      bookmarks.map((item) => normalizeFolderName(item.folder || "")).filter(Boolean)
    ).size;
    const tagCount = new Set(bookmarks.flatMap((item) => item.tags || [])).size;
    const query = (searchInput?.value || "").trim();
    const contextBits = [];

    if (query) {
      contextBits.push(`검색: "${query}"`);
    }
    if (selectedFolder) {
      contextBits.push(`폴더: ${selectedFolder}`);
    }
    if (selectedTags.length) {
      contextBits.push(`태그: ${selectedTags.join(", ")}`);
    }
    if (smartFilter) {
      contextBits.push(`스마트 뷰: ${getSmartFilterLabel(smartFilter) || smartFilter}`);
    } else if (currentSort !== "recentAdd") {
      contextBits.push(`정렬: ${getSortLabel(currentSort)}`);
    }

    if (heroBookmarkCount) {
      heroBookmarkCount.textContent = String(bookmarks.length);
    }
    if (heroFolderCount) {
      heroFolderCount.textContent = String(folderCount);
    }
    if (heroTagCount) {
      heroTagCount.textContent = String(tagCount);
    }
    if (heroSyncStatus) {
      heroSyncStatus.textContent = driveStatusEl?.textContent || "미연결";
    }
    if (heroSyncDetail) {
      const lastSyncAt = getLatestSyncAt();
      if (syncInFlight) {
        heroSyncDetail.textContent = "Drive와 동기화 중";
      } else if (lastSyncAt) {
        heroSyncDetail.textContent = `마지막 동기화 ${formatRelativeTime(lastSyncAt)}`;
      } else if (getStoredGoogleToken()) {
        heroSyncDetail.textContent = "연결됨 · 아직 동기화 전";
      } else {
        heroSyncDetail.textContent = "최근 동기화 기록 없음";
      }
    }
    if (heroSelectionCount) {
      heroSelectionCount.textContent =
        selectedBookmarkIds.size > 0
          ? `${selectedBookmarkIds.size}개 선택됨`
          : `현재 ${visibleCount}개 표시`;
    }
    if (resultsCountLabel) {
      resultsCountLabel.textContent = `${visibleCount}개 표시`;
    }
    if (resultsContextLabel) {
      resultsContextLabel.textContent = contextBits.join(" · ") || "전체 컬렉션";
    }
    if (activeViewBadge) {
      activeViewBadge.textContent = getViewModeLabel(currentViewMode);
    }
  }

  function applyTheme() {
    const resolvedTheme = resolveThemeTone(themePreset);
    document.body.dataset.themePreset = themePreset;
    document.body.dataset.theme = resolvedTheme;
    localStorage.setItem(THEME_KEY, themePreset);
  }

  function isKnownThemePreset(value) {
    return (
      value === THEME_PRESET_DEEP_OCEAN ||
      value === THEME_PRESET_GLACIER ||
      value === THEME_PRESET_SOLARIS
    );
  }

  function resolveThemeTone(preset) {
    return preset === THEME_PRESET_SOLARIS ? "light" : "dark";
  }

  function setThemePreset(nextPreset) {
    if (!isKnownThemePreset(nextPreset) || nextPreset === themePreset) {
      return;
    }
    themePreset = nextPreset;
    applyTheme();
    updateThemePresetControls();
  }

  function updateThemePresetControls() {
    if (!themeModeButtons.length) {
      return;
    }

    themeModeButtons.forEach((button) => {
      const preset = button.dataset.themePreset;
      const active = preset === themePreset;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (!themeModeHint) {
      return;
    }

    const presetLabels = {
      [THEME_PRESET_DEEP_OCEAN]: "현재 Deep Ocean 테마가 적용되어 있습니다.",
      [THEME_PRESET_GLACIER]: "현재 Glacier 테마가 적용되어 있습니다.",
      [THEME_PRESET_SOLARIS]: "현재 Solaris 테마가 적용되어 있습니다."
    };
    themeModeHint.textContent =
      presetLabels[themePreset] || "현재 테마가 적용되어 있습니다.";
  }

  function canUseExtensionLocalStorageMirror() {
    return (
      IS_EXTENSION_CONTEXT &&
      typeof chrome !== "undefined" &&
      !!chrome.storage?.local
    );
  }

  function bootstrapExtensionStorageMirror() {
    if (!canUseExtensionLocalStorageMirror()) {
      return Promise.resolve();
    }

    const keys = [GOOGLE_CONFIG_KEY, GOOGLE_TOKEN_KEY, DRIVE_SYNC_CACHE_KEY];
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (items) => {
        keys.forEach((key) => {
          const value = items?.[key];
          if (typeof value === "string" && value) {
            localStorage.setItem(key, value);
          }
        });
        resolve();
      });
    });
  }

  function mirrorLocalStorageKeyToExtensionStorage(key) {
    if (!canUseExtensionLocalStorageMirror()) {
      return;
    }

    const value = localStorage.getItem(key);
    if (value === null) {
      chrome.storage.local.remove(key);
      return;
    }

    chrome.storage.local.set({ [key]: value });
  }

  function requestBackgroundSyncNow() {
    if (
      !IS_EXTENSION_CONTEXT ||
      typeof chrome === "undefined" ||
      !chrome.runtime?.sendMessage
    ) {
      return;
    }

    chrome.runtime.sendMessage({ type: "remember-bg-sync-now" }, () => {
      void chrome.runtime.lastError;
    });
  }

  function bindExtensionRuntimeListeners() {
    if (!canUseExtensionLocalStorageMirror() || extensionRuntimeListenerBound) {
      return;
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === BG_SYNC_WARNING_MESSAGE) {
        if (message.message) {
          showToast(String(message.message));
        }
        return;
      }

      if (message.type === BG_SYNC_UPDATED_MESSAGE) {
        bootstrapExtensionStorageMirror()
          .then(() => hydrateDataCache())
          .then(() => {
            render();
          })
          .catch(() => {});
      }
    });

    extensionRuntimeListenerBound = true;
  }

  function isCompactLayout() {
    if (APP_CONTEXT === "extension") {
      return true;
    }
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function openSidePanel() {
    if (!sidePanel) {
      return;
    }
    document.body.classList.add("side-open");
    if (sideBackdrop) {
      sideBackdrop.hidden = false;
    }
  }

  function closeSidePanel() {
    document.body.classList.remove("side-open");
    if (sideBackdrop) {
      sideBackdrop.hidden = true;
    }
  }

  function closeSidePanelOnCompact() {
    if (!isCompactLayout()) {
      return;
    }
    closeSidePanel();
  }

  function setFacetPane(pane) {
    const nextPane = pane === "tags" ? "tags" : "folders";
    const shouldToggleOff = nextPane === "tags" && currentFacetPane === "tags" && !tagsPane?.hidden;
    currentFacetPane = shouldToggleOff ? "folders" : nextPane;

    if (showFolderPaneBtn) {
      showFolderPaneBtn.classList.toggle("active", currentFacetPane === "folders");
    }
    if (showTagPaneBtn) {
      showTagPaneBtn.classList.toggle("active", currentFacetPane === "tags");
    }
    if (foldersPane) {
      foldersPane.hidden = false;
    }
    if (tagsPane) {
      tagsPane.hidden = currentFacetPane !== "tags";
    }
    if (tagPaneBackdrop) {
      tagPaneBackdrop.hidden = currentFacetPane !== "tags";
    }
  }

  function saveCollapsedFolderState() {
    try {
      localStorage.setItem(
        FOLDER_COLLAPSE_KEY,
        JSON.stringify(Array.from(collapsedFolderPaths))
      );
    } catch (_error) {
      // ignore storage write errors for UI preference
    }
  }

  function toggleFolderCollapsed(path) {
    const normalizedPath = normalizeFolderName(path);
    if (!normalizedPath || normalizedPath === DEFAULT_FOLDER_NAME) {
      return;
    }

    if (collapsedFolderPaths.has(normalizedPath)) {
      collapsedFolderPaths.delete(normalizedPath);
    } else {
      collapsedFolderPaths.add(normalizedPath);
    }

    saveCollapsedFolderState();
    renderFolderFilters();
  }

  function normalizeFolderMetaEntry(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const emoji = String(value.emoji || "").trim().slice(0, 3);
    const colorRaw = String(value.color || "").trim();
    const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw.toLowerCase() : "";
    if (!emoji && !color) {
      return null;
    }
    return { emoji, color };
  }

  function normalizeFolderMetaMap(value) {
    if (!value || typeof value !== "object") {
      return {};
    }
    const next = {};
    Object.keys(value).forEach((path) => {
      const normalizedPath = normalizeFolderName(path);
      if (!normalizedPath || normalizedPath === DEFAULT_FOLDER_NAME) {
        return;
      }
      const normalizedMeta = normalizeFolderMetaEntry(value[path]);
      if (!normalizedMeta) {
        return;
      }
      next[normalizedPath] = normalizedMeta;
    });
    return next;
  }

  function saveFolderMetaMap() {
    try {
      localStorage.setItem(FOLDER_META_KEY, JSON.stringify(folderMetaMap));
    } catch (_error) {
      // ignore preference write errors
    }
  }

  function getFolderMeta(path) {
    const normalizedPath = normalizeFolderName(path);
    return folderMetaMap[normalizedPath] || null;
  }

  function withHexAlpha(color, alphaHex) {
    const safeColor = String(color || "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(safeColor)) {
      return "";
    }
    const safeAlpha = String(alphaHex || "").trim();
    if (!/^[0-9a-fA-F]{2}$/.test(safeAlpha)) {
      return safeColor;
    }
    return `${safeColor}${safeAlpha}`;
  }

  function handleOAuthCallbackPage() {
    const params = new URLSearchParams(window.location.search);
    const isCallback = params.get("oauth_callback") === "1";
    if (!isCallback || !window.opener) {
      return false;
    }

    window.opener.postMessage(
      {
        source: "remember-oauth",
        hash: window.location.hash || ""
      },
      window.location.origin
    );

    window.close();
    return true;
  }

  function bindUiEvents() {
    sortSelect.addEventListener("change", function () {
      currentSort = this.value;
      renderBookmarks();
    });

    folderFilterSelect?.addEventListener("change", function () {
      selectedFolder = this.value;
      renderFolderFilters();
      renderBookmarks();
    });

    openSidePanelBtn?.addEventListener("click", openSidePanel);
    closeSidePanelBtn?.addEventListener("click", closeSidePanel);
    sideBackdrop?.addEventListener("click", closeSidePanel);

    showFolderPaneBtn?.addEventListener("click", () => {
      setFacetPane("folders");
    });

    showTagPaneBtn?.addEventListener("click", () => {
      setFacetPane("tags");
    });

    closeTagPaneBtn?.addEventListener("click", () => {
      setFacetPane("folders");
    });
    tagPaneBackdrop?.addEventListener("click", () => {
      setFacetPane("folders");
    });

    tagSearchInput?.addEventListener("input", () => {
      tagSearchKeyword = (tagSearchInput.value || "").trim().toLowerCase();
      renderTagFilters();
    });

    viewToggleButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.viewMode;
        if (!mode || mode === currentViewMode) {
          return;
        }
        saveViewMode(mode);
      });
    });

    searchInput.addEventListener("input", () => {
      smartFilter = "";
      renderBookmarks();
    });

    searchShortcutButtons.forEach((button) => {
      button.addEventListener("click", () => {
        insertSearchSnippet(button.dataset.searchSnippet);
      });
    });

    clearFiltersBtn?.addEventListener("click", () => {
      resetCollectionFilters();
    });

    workspacePresetButtons.forEach((button) => {
      button.addEventListener("click", () => {
        applyWorkspacePreset(button.dataset.workspacePreset || "");
      });
    });

    appTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.appTab || "dashboard";
        setAppTab(tab);
      });
    });

    heroFocusSearchBtn?.addEventListener("click", () => {
      searchInput.focus();
      searchInput.select();
    });
    heroBackupBtn?.addEventListener("click", exportData);
    heroDriveActionBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        await syncWithDrive();
        render();
        showToast("양방향 동기화 완료");
      });
    });
    heroCheckLinksBtn?.addEventListener("click", () => {
      runDeadLinkCheckBatch({ force: true, full: true }).catch(() => {});
    });
    heroOpenSettingsPanelBtn?.addEventListener("click", openSettings);

    cancelBtn1?.addEventListener("click", closeSheet);

    backBtn?.addEventListener("click", () => {
      if (sheetMode === "add") {
        step1.classList.add("active");
        step2.classList.remove("active");
        updateSheetProgress(1);
      } else {
        closeSheet();
      }
    });

    nextBtn?.addEventListener("click", async () => {
      const normalized = normalizeUrl(siteUrlInput.value.trim());
      if (!normalized) {
        alert("올바른 URL을 입력해주세요");
        return;
      }

      siteUrlInput.value = normalized;
      if (!siteNameInput.value.trim()) {
        siteNameInput.value = suggestName(normalized);
      }

      await autofillMetadataFromUrl(normalized);

      step1.classList.remove("active");
      step2.classList.add("active");
      updateSheetProgress(2);
    });

    siteUrlInput?.addEventListener("blur", () => {
      const normalized = normalizeUrl(siteUrlInput.value.trim());
      if (!normalized) {
        return;
      }
      autofillMetadataFromUrl(normalized);
    });

    saveBtn?.addEventListener("click", saveBookmarkFromSheet);
    openSheetBtn?.addEventListener("click", openAdd);
    topbarAddSiteBtn?.addEventListener("click", openAdd);
    heroAddSiteBtn?.addEventListener("click", openAdd);
    heroFocusSearchBtn?.addEventListener("click", focusSearchInput);
    openSettingsBtn?.addEventListener("click", openSettings);
    sidebarSettingsBtn?.addEventListener("click", openSettings);
    heroOpenSettingsBtn?.addEventListener("click", openSettings);
    heroOpenSettingsPanelBtn?.addEventListener("click", openSettings);
    heroOpenSettingsPanelBtnSecondary?.addEventListener("click", openSettings);
    heroBackupBtn?.addEventListener("click", exportData);
    heroDriveActionBtn?.addEventListener("click", () => driveSyncBtn?.click());
    heroCheckLinksBtn?.addEventListener("click", () => {
      runDeadLinkCheckBatch({ force: true, full: true }).catch(() => {});
    });
    closeSettingsBtn?.addEventListener("click", closeSettings);
    themeModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const preset = button.dataset.themePreset;
        if (!preset || preset === themePreset) {
          return;
        }
        setThemePreset(preset);
      });
    });

    sheetOverlay?.addEventListener("click", (event) => {
      if (event.target === sheetOverlay) {
        closeSheet();
      }
    });

    settingsOverlay?.addEventListener("click", (event) => {
      if (event.target === settingsOverlay) {
        closeSettings();
      }
    });

    actionDialogOverlay?.addEventListener("click", (event) => {
      if (event.target === actionDialogOverlay) {
        closeActionDialog();
      }
    });
    actionDialogCloseBtn?.addEventListener("click", closeActionDialog);
    actionDialogCancelBtn?.addEventListener("click", closeActionDialog);
    actionDialogConfirmBtn?.addEventListener("click", () => {
      submitActionDialog().catch(() => {});
    });
    actionDialogInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitActionDialog().catch(() => {});
      }
    });

    readerOverlay?.addEventListener("click", (event) => {
      if (event.target === readerOverlay) {
        closeReader();
      }
    });

    readerCloseBtn?.addEventListener("click", closeReader);

    document.addEventListener("keydown", (event) => {
      if (handleKeyboardShortcuts(event)) {
        return;
      }

      if (event.key !== "Escape") {
        return;
      }
      closeSheet();
      closeSettings();
      closeActionDialog();
      closeReader();
      closeSidePanel();
    });

    exportBtn?.addEventListener("click", exportData);
    importBtn?.addEventListener("click", () => importFileInput?.click());
    importFileInput?.addEventListener("change", importData);
    checkDeadLinksBtn?.addEventListener("click", () => {
      runDeadLinkCheckBatch({ force: true, full: true }).catch(() => {});
    });
    deleteBrokenLinksBtn?.addEventListener("click", deleteBrokenLinks);

    bookmarkletBtn?.addEventListener("click", copyBookmarkletCode);

    saveCurrentTabBtn?.addEventListener("click", () => {
      if (!IS_EXTENSION_CONTEXT) {
        return;
      }
      captureCurrentTabToSheet();
    });

    bulkToggleVisibleBtn?.addEventListener("click", toggleSelectVisibleBookmarks);
    bulkMoveFolderBtn?.addEventListener("click", bulkMoveToFolder);
    bulkAddTagBtn?.addEventListener("click", bulkAddTags);
    bulkRemoveTagBtn?.addEventListener("click", bulkRemoveTags);
    bulkDeleteBtn?.addEventListener("click", bulkDeleteSelected);
    bulkClearBtn?.addEventListener("click", clearSelectedBookmarks);

    driveConnectBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        await ensureGoogleToken();
        scheduleAutoSync({ immediate: true, fullReconcile: true });
        showToast("Google Drive 연결 완료");
      });
    });

    driveSyncBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        await syncWithDrive();
        render();
        showToast("양방향 동기화 완료");
      });
    });

    drivePushBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        await uploadLocalToDrive();
        showToast("Drive에 저장 완료");
      });
    });

    drivePullBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        const loaded = await downloadDriveToLocal();
        if (!loaded) {
          showToast("Drive에 저장된 데이터가 없습니다");
          return;
        }
        render();
        showToast("Drive 데이터 불러오기 완료");
      });
    });

    saveGoogleConfigBtn?.addEventListener("click", () => {
      const clientId = (googleClientIdInput?.value || "").trim();
      const tokenDuration = normalizeGoogleTokenDuration(googleTokenDurationSelect?.value);
      if (!clientId) {
        alert("OAuth Client ID를 입력해주세요");
        return;
      }
      if (!clientId.includes(".apps.googleusercontent.com")) {
        alert("Client ID 형식이 올바르지 않습니다");
        return;
      }

      saveGoogleConfig({
        clientId,
        tokenDuration
      });
      clearGoogleToken();
      clearDriveSyncCache();
      cancelAutoSync();
      refreshDriveStatus();
      showToast("OAuth 설정을 저장했습니다");
    });

    clearGoogleConfigBtn?.addEventListener("click", () => {
      if (!confirm("Google 연동 설정과 토큰을 지울까요?")) {
        return;
      }
      clearGoogleConfig();
      clearGoogleToken();
      clearDriveSyncCache();
      cancelAutoSync();
      if (googleClientIdInput) {
        googleClientIdInput.value = "";
      }
      if (googleTokenDurationSelect) {
        googleTokenDurationSelect.value = GOOGLE_TOKEN_DURATION_DEFAULT;
      }
      refreshDriveStatus();
      showToast("Google 설정을 초기화했습니다");
    });

    saveFolderStyleBtn?.addEventListener("click", () => {
      const folderPath = normalizeFolderName(folderStyleTarget?.value || "");
      if (!folderPath || folderPath === DEFAULT_FOLDER_NAME) {
        showToast("스타일을 적용할 폴더를 선택해주세요");
        return;
      }

      const rawEmoji = String(folderEmojiInput?.value || "").trim();
      const emoji = Array.from(rawEmoji).slice(0, 1).join("");
      const color = String(folderColorInput?.value || "").trim();
      const normalized = normalizeFolderMetaEntry({ emoji, color });

      if (!normalized) {
        delete folderMetaMap[folderPath];
      } else {
        folderMetaMap[folderPath] = normalized;
      }

      saveFolderMetaMap();
      render();
      showToast("폴더 스타일을 저장했습니다");
    });

    clearFolderStyleBtn?.addEventListener("click", () => {
      const folderPath = normalizeFolderName(folderStyleTarget?.value || "");
      if (!folderPath || folderPath === DEFAULT_FOLDER_NAME) {
        return;
      }
      delete folderMetaMap[folderPath];
      saveFolderMetaMap();
      render();
      showToast("폴더 스타일을 초기화했습니다");
    });

    folderStyleTarget?.addEventListener("change", () => {
      syncFolderStyleEditorFromSelection();
    });

    window.addEventListener("focus", () => {
      scheduleAutoSync({ immediate: true, fullReconcile: true });
    });

    window.addEventListener("resize", () => {
      if (!isCompactLayout()) {
        closeSidePanel();
      }
      updateScrollTopButtonVisibility();
      updateFloatingCtaVisibility();
    });

    window.addEventListener("scroll", () => {
      updateScrollTopButtonVisibility();
      const currentY = Math.max(window.scrollY || 0, 0);
      const compact = isCompactDeviceLayout();
      if (compact) {
        if (currentY - lastScrollY > 8 && currentY > 120) {
          ctaHiddenByScroll = true;
        } else if (lastScrollY - currentY > 8) {
          ctaHiddenByScroll = false;
        }
      } else {
        ctaHiddenByScroll = false;
      }
      lastScrollY = currentY;
      updateFloatingCtaVisibility();
    });

    scrollTopBtn?.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleAutoSync({ immediate: true, fullReconcile: true });
        scheduleDeadLinkCheck();
      }
    });
  }

  function loadSavedGoogleConfig() {
    const config = getGoogleConfig();
    if (googleClientIdInput && config.clientId) {
      googleClientIdInput.value = config.clientId;
    }
    if (googleTokenDurationSelect) {
      googleTokenDurationSelect.value = config.tokenDuration;
    }
  }

  function refreshDriveStatus(mode) {
    if (!driveStatusEl) {
      return;
    }

    if (mode === "syncing") {
      driveStatusEl.textContent = "작업중";
      driveStatusEl.className = "drive-status syncing";
      updateWorkspaceSummary(currentRenderItems.length);
      return;
    }

    const token = getStoredGoogleToken();
    if (token) {
      driveStatusEl.textContent = "연결됨";
      driveStatusEl.className = "drive-status connected";
      updateWorkspaceSummary(currentRenderItems.length);
      return;
    }

    driveStatusEl.textContent = "미연결";
    driveStatusEl.className = "drive-status offline";
    updateWorkspaceSummary(currentRenderItems.length);
  }

  function getDriveSyncCache() {
    const raw = localStorage.getItem(DRIVE_SYNC_CACHE_KEY);
    if (!raw) {
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

  function saveDriveSyncCache(patch = {}) {
    const current = getDriveSyncCache();
    const next = {
      fileId: String(
        Object.prototype.hasOwnProperty.call(patch, "fileId") ? patch.fileId : current.fileId
      ).trim(),
      lastFullSyncAt: toSafeNumber(
        Object.prototype.hasOwnProperty.call(patch, "lastFullSyncAt")
          ? patch.lastFullSyncAt
          : current.lastFullSyncAt,
        0
      ),
      lastFastSyncAt: toSafeNumber(
        Object.prototype.hasOwnProperty.call(patch, "lastFastSyncAt")
          ? patch.lastFastSyncAt
          : current.lastFastSyncAt,
        0
      )
    };

    localStorage.setItem(DRIVE_SYNC_CACHE_KEY, JSON.stringify(next));
    mirrorLocalStorageKeyToExtensionStorage(DRIVE_SYNC_CACHE_KEY);
  }

  function clearDriveSyncCache() {
    localStorage.removeItem(DRIVE_SYNC_CACHE_KEY);
    mirrorLocalStorageKeyToExtensionStorage(DRIVE_SYNC_CACHE_KEY);
  }

  function shouldRunPeriodicFullSync() {
    const cache = getDriveSyncCache();
    if (!cache.fileId) {
      return true;
    }
    return Date.now() - cache.lastFullSyncAt >= AUTO_SYNC_FULL_RECONCILE_MS;
  }

  function canAutoSync() {
    const config = getGoogleConfig();
    if (!config.clientId) {
      return false;
    }
    return !!getStoredGoogleToken();
  }

  function cancelAutoSync() {
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
    autoSyncPending = false;
    autoSyncForceFull = false;
  }

  function scheduleAutoSync(options = {}) {
    if (options.fullReconcile) {
      autoSyncForceFull = true;
    }

    if (!canAutoSync()) {
      cancelAutoSync();
      return;
    }

    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }

    if (syncInFlight) {
      autoSyncPending = true;
      return;
    }

    const delay = options.immediate ? 80 : AUTO_SYNC_DELAY_MS;
    autoSyncTimer = setTimeout(() => {
      const fullReconcile = autoSyncForceFull;
      autoSyncForceFull = false;
      autoSyncTimer = null;
      runAutoSync({ fullReconcile });
    }, delay);
  }

  function runAutoSync(options = {}) {
    if (!canAutoSync()) {
      cancelAutoSync();
      return;
    }

    const fullReconcile = options.fullReconcile === true || shouldRunPeriodicFullSync();

    if (syncInFlight) {
      autoSyncPending = true;
      if (fullReconcile) {
        autoSyncForceFull = true;
      }
      return;
    }

    let syncResult = { skipped: false, message: "" };

    runDriveTask(
      async () => {
        syncResult = await syncWithDrive({
          interactive: false,
          safeMode: true,
          mode: fullReconcile ? "full" : "autoFast"
        });

        if (!syncResult?.skipped && fullReconcile) {
          render();
        }
      },
      { silent: true }
    ).then((succeeded) => {
      if (syncResult?.skipped) {
        const now = Date.now();
        if (now - lastAutoSyncErrorAt >= AUTO_SYNC_ERROR_COOLDOWN_MS) {
          lastAutoSyncErrorAt = now;
          showToast(syncResult.message || "자동 동기화를 안전모드로 중단했습니다");
        }
        return;
      }

      if (succeeded) {
        lastAutoSyncErrorAt = 0;
        return;
      }

      const now = Date.now();
      if (now - lastAutoSyncErrorAt >= AUTO_SYNC_ERROR_COOLDOWN_MS) {
        lastAutoSyncErrorAt = now;
        showToast("자동 동기화 실패: 설정에서 Drive 상태를 확인해주세요");
      }
    });
  }

  function runDriveTask(task, options = {}) {
    if (syncInFlight) {
      return Promise.resolve(false);
    }

    syncInFlight = true;
    refreshDriveStatus("syncing");

    return Promise.resolve()
      .then(task)
      .then(() => true)
      .catch((error) => {
        if (!options.silent) {
          const message =
            error instanceof Error ? error.message : "Drive 작업 중 오류가 발생했습니다";
          showToast(message);
        }
        return false;
      })
      .finally(() => {
        refreshDriveStatus();
        syncInFlight = false;

        if (autoSyncPending) {
          const shouldResume = canAutoSync();
          const fullReconcile = autoSyncForceFull;
          autoSyncPending = false;
          autoSyncForceFull = false;
          if (!shouldResume) {
            return;
          }
          scheduleAutoSync({ immediate: true, fullReconcile });
        }
      });
  }
  function render() {
    applyViewModeClass();
    updateViewToggleButtons();
    updateAppTabUi();
    renderFolderFilters();
    renderFolderStyleControls();
    renderTagFilters();
    renderSuggestions();
    renderBookmarks();
    renderReaderTab();
    renderStatsTab();
    updateWorkspaceSummary(currentRenderItems.length);
  }

  function setAppTab(nextTab) {
    currentAppTab = ["dashboard", "reader", "stats"].includes(nextTab)
      ? nextTab
      : "dashboard";
    updateAppTabUi();
  }

  function updateAppTabUi() {
    appTabButtons.forEach((button) => {
      const active = (button.dataset.appTab || "dashboard") === currentAppTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (dashboardView) {
      dashboardView.hidden = currentAppTab !== "dashboard";
    }
    if (readerTabView) {
      readerTabView.hidden = currentAppTab !== "reader";
    }
    if (statsTabView) {
      statsTabView.hidden = currentAppTab !== "stats";
    }
  }

  function renderReaderTab() {
    if (!readerTabList) {
      return;
    }
    const items = getBookmarks()
      .filter((item) =>
        item.reader &&
        Array.isArray(item.reader.blocks) &&
        item.reader.blocks.some(
          (block) => block && !String(block).includes("본문 텍스트를 충분히 추출하지 못했습니다.")
        )
      )
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    readerTabList.innerHTML = "";
    if (readerTabCount) {
      readerTabCount.textContent = `${items.length} items`;
    }

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "tab-empty";
      empty.textContent = "읽기 가능한 항목이 아직 없습니다.";
      readerTabList.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("article");
      row.className = "reader-tab-item";

      const copy = document.createElement("div");
      copy.className = "reader-tab-copy";
      const title = document.createElement("h3");
      title.textContent = item.name || item.url;
      const meta = document.createElement("p");
      meta.textContent = `${item.domain || extractDomain(item.url) || "bookmark"} · ${formatSavedAtLabel(item)}`;
      copy.append(title, meta);

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Open Reader";
      button.addEventListener("click", () => openReader(item.id));

      row.append(copy, button);
      readerTabList.appendChild(row);
    });
  }

  function renderStatsTab() {
    const bookmarks = getBookmarks();
    const folderCounts = new Map();
    const tagCounts = new Map();
    let readerCount = 0;

    bookmarks.forEach((item) => {
      const folder = normalizeFolderName(item.folder || "");
      folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
      (item.tags || []).forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
      if (
        item.reader &&
        Array.isArray(item.reader.blocks) &&
        item.reader.blocks.some(
          (block) => block && !String(block).includes("본문 텍스트를 충분히 추출하지 못했습니다.")
        )
      ) {
        readerCount += 1;
      }
    });

    if (statsBookmarkCount) statsBookmarkCount.textContent = String(bookmarks.length);
    if (statsFolderCount) statsFolderCount.textContent = String(folderCounts.size);
    if (statsTagCount) statsTagCount.textContent = String(tagCounts.size);
    if (statsReaderCount) statsReaderCount.textContent = String(readerCount);
    if (statsUpdatedLabel) {
      statsUpdatedLabel.textContent = bookmarks.length
        ? `최근 업데이트 ${formatRelativeTime(Math.max(...bookmarks.map((item) => item.updatedAt || 0)))}`
        : "최근 업데이트 없음";
    }

    renderStatsList(statsTopFolders, folderCounts);
    renderStatsList(statsTopTags, tagCounts);
  }

  function renderStatsList(container, counts) {
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const entries = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "tab-empty";
      empty.textContent = "데이터가 없습니다.";
      container.appendChild(empty);
      return;
    }
    entries.forEach(([label, count]) => {
      const row = document.createElement("div");
      row.className = "stats-list-row";
      row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${count}</strong>`;
      container.appendChild(row);
    });
  }

  function renderFolderFilters() {
    const bookmarks = getBookmarks();
    const exactFolderCounts = new Map();
    bookmarks.forEach((item) => {
      const folderName = normalizeFolderName(item.folder || "");
      exactFolderCounts.set(folderName, (exactFolderCounts.get(folderName) || 0) + 1);
    });

    const folderCounts = new Map();
    exactFolderCounts.forEach((count, path) => {
      const segments = String(path || "")
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part);
      let prefix = "";
      segments.forEach((segment) => {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        folderCounts.set(prefix, (folderCounts.get(prefix) || 0) + count);
      });
    });

    updateFolderSuggestions(Array.from(folderCounts.keys()).sort((a, b) => a.localeCompare(b, "ko")));

    if (selectedFolder && !folderCounts.has(selectedFolder)) {
      selectedFolder = "";
    }

    if (selectedFolder) {
      const parts = selectedFolder.split("/");
      let parentPath = "";
      for (let i = 0; i < parts.length - 1; i += 1) {
        parentPath = parentPath ? `${parentPath}/${parts[i]}` : parts[i];
        collapsedFolderPaths.delete(parentPath);
      }
    }

    const childrenByParent = new Map();
    Array.from(folderCounts.keys()).forEach((path) => {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (!childrenByParent.has(parent)) {
        childrenByParent.set(parent, []);
      }
      childrenByParent.get(parent).push(path);
    });

    childrenByParent.forEach((children) => {
      children.sort((a, b) => {
        const aName = a.split("/").pop() || a;
        const bName = b.split("/").pop() || b;
        return aName.localeCompare(bName, "ko");
      });
    });

    const folderEntries = [];
    function walkTree(parentPath, level) {
      const children = childrenByParent.get(parentPath) || [];
      children.forEach((childPath) => {
        const hasChildren = (childrenByParent.get(childPath) || []).length > 0;
        const isCollapsed = hasChildren && collapsedFolderPaths.has(childPath);
        folderEntries.push({
          value: childPath,
          label: childPath.split("/").pop() || childPath,
          count: folderCounts.get(childPath) || 0,
          level,
          hasChildren,
          isCollapsed
        });
        if (!isCollapsed) {
          walkTree(childPath, level + 1);
        }
      });
    }
    walkTree("", 0);

    if (folderFilterSelect) {
      folderFilterSelect.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "전체 폴더";
      folderFilterSelect.appendChild(allOption);

      folderEntries.forEach(({ value }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        folderFilterSelect.appendChild(option);
      });

      folderFilterSelect.value = selectedFolder || "";
    }

    if (!folderFiltersDiv) {
      return;
    }

    folderFiltersDiv.innerHTML = "";
    folderFiltersDiv.appendChild(createFolderChip("전체", bookmarks.length, "", 0));

    folderEntries.forEach(({ label, count, value, level, hasChildren, isCollapsed }) => {
      folderFiltersDiv.appendChild(
        createFolderChip(label, count, value, level, {
          hasChildren,
          isCollapsed
        })
      );
    });
  }

  function collectFolderPathsForUi() {
    const set = new Set();
    getBookmarks().forEach((item) => {
      const folderName = normalizeFolderName(item.folder || "");
      if (!folderName || folderName === DEFAULT_FOLDER_NAME) {
        return;
      }
      const parts = folderName.split("/");
      let path = "";
      parts.forEach((part) => {
        path = path ? `${path}/${part}` : part;
        set.add(path);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }

  function renderFolderStyleControls() {
    if (!folderStyleTarget) {
      return;
    }

    const folders = collectFolderPathsForUi();
    const currentValue =
      folderStyleTarget.value && folders.includes(folderStyleTarget.value)
        ? folderStyleTarget.value
        : folders[0] || "";

    folderStyleTarget.innerHTML = "";
    if (!folders.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "스타일 지정할 폴더 없음";
      folderStyleTarget.appendChild(empty);
      folderStyleTarget.disabled = true;
      if (folderEmojiInput) {
        folderEmojiInput.value = "";
      }
      if (folderColorInput) {
        folderColorInput.value = "#1d4ed8";
      }
      return;
    }

    folderStyleTarget.disabled = false;
    folders.forEach((path) => {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = path;
      folderStyleTarget.appendChild(option);
    });
    folderStyleTarget.value = currentValue;
    syncFolderStyleEditorFromSelection();
  }

  function syncFolderStyleEditorFromSelection() {
    if (!folderStyleTarget) {
      return;
    }
    const selectedPath = normalizeFolderName(folderStyleTarget.value || "");
    const meta = selectedPath ? getFolderMeta(selectedPath) : null;
    if (folderEmojiInput) {
      folderEmojiInput.value = meta?.emoji || "";
    }
    if (folderColorInput) {
      folderColorInput.value = meta?.color || "#1d4ed8";
    }
  }

  function createFolderChip(label, count, value, level, options = {}) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `${value ? "folder-chip folder-node" : "folder-chip"}${selectedFolder === value ? " active" : ""}`;
    chip.setAttribute("aria-pressed", selectedFolder === value ? "true" : "false");
    chip.dataset.folderValue = value;
    if (value) {
      const safeLevel = Math.max(0, Math.min(6, level || 0));
      chip.style.setProperty("--indent", `${safeLevel * 0.62}rem`);
    }

    const folderMeta = value ? getFolderMeta(value) : null;
    if (folderMeta?.color && selectedFolder !== value) {
      chip.style.backgroundColor = withHexAlpha(folderMeta.color, "1a");
      chip.style.borderColor = withHexAlpha(folderMeta.color, "66");
      chip.style.color = folderMeta.color;
    }

    if (options.hasChildren) {
      const toggle = document.createElement("span");
      toggle.className = "folder-toggle";
      toggle.textContent = options.isCollapsed ? "▸" : "▾";
      toggle.setAttribute("data-tooltip", options.isCollapsed ? "폴더 펼치기" : "폴더 접기");
      toggle.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFolderCollapsed(value);
      };
      chip.appendChild(toggle);
    }

    const text = document.createElement("span");
    text.className = "folder-label";
    text.textContent = `${folderMeta?.emoji || ""}${folderMeta?.emoji ? " " : ""}${label}`;
    chip.appendChild(text);

    const countEl = document.createElement("span");
    countEl.className = "count";
    countEl.textContent = String(count);
    chip.appendChild(countEl);

    chip.onclick = () => {
      if (selectedFolder === value) {
        return;
      }
      selectedFolder = value;
      if (folderFilterSelect) {
        folderFilterSelect.value = value;
      }
      renderFolderFilters();
      renderBookmarks();
      closeSidePanelOnCompact();
    };

    chip.addEventListener("dragover", (event) => {
      if (!draggingBookmarkIds.length || !value) {
        return;
      }
      event.preventDefault();
      chip.classList.add("drop-ready");
    });

    chip.addEventListener("dragleave", () => {
      chip.classList.remove("drop-ready");
    });

    chip.addEventListener("drop", (event) => {
      chip.classList.remove("drop-ready");
      if (!draggingBookmarkIds.length || !value) {
        return;
      }
      event.preventDefault();
      moveBookmarksToFolderIds(draggingBookmarkIds, value, {
        toastMessage: `${draggingBookmarkIds.length}개 폴더 이동`
      });
      draggingBookmarkIds = [];
      document.body.classList.remove("dragging-bookmark");
    });

    return chip;
  }

  function renderTagFilters() {
    tagFiltersDiv.innerHTML = "";
    const bookmarks = getBookmarks();
    const tagCounts = {};

    bookmarks.forEach((item) => {
      (item.tags || []).forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    const tags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));
    updateTagSuggestions(tags);
    const visibleTags = tagSearchKeyword
      ? tags.filter((tag) => tag.toLowerCase().includes(tagSearchKeyword))
      : tags;

    if (!visibleTags.length) {
      const empty = document.createElement("span");
      empty.className = "tag-empty";
      empty.textContent = "일치하는 태그가 없습니다";
      tagFiltersDiv.appendChild(empty);
      return;
    }

    visibleTags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip" + (selectedTags.includes(tag) ? " selected" : "");
      chip.textContent = tag;
      chip.onclick = () => {
        toggleTagFilter(tag);
        closeSidePanelOnCompact();
      };
      tagFiltersDiv.appendChild(chip);
    });
  }

  function renderSuggestions() {
    suggestionsDiv.innerHTML = "";

    appendSuggestion("전체", () => {
      applyWorkspacePreset("recentAdd");
    });

    appendSuggestion("최근 추가", () => {
      applyWorkspacePreset("recentAdd");
    });

    appendSuggestion("최근 방문", () => {
      applyWorkspacePreset("recentVisit");
    });

    appendSuggestion("자주 방문", () => {
      applyWorkspacePreset("frequent");
    });

    appendSuggestion("30일 이상 안 본", () => {
      applyWorkspacePreset("stale30");
    });
  }

  function appendSuggestion(text, onClick) {
    const el = document.createElement("span");
    el.className = "suggestion";
    el.textContent = text;
    el.onclick = onClick;
    suggestionsDiv.appendChild(el);
  }

  function parseAdvancedSearchQuery(rawQuery) {
    const parsed = {
      domainFilter: null,
      tagFilter: null,
      folderFilter: null,
      freeTerms: [],
      hasChosungTerms: false,
      isPinned: null,
      hasReader: false,
      dateAfter: null,
      dateBefore: null,
      isBroken: null
    };

    const tokens = String(rawQuery || "")
      .trim()
      .split(/\s+/)
      .filter((token) => token);

    tokens.forEach((token) => {
      const lower = token.toLowerCase();
      if (lower.startsWith("site:")) {
        parsed.domainFilter = lower.slice(5).trim() || null;
        return;
      }
      if (lower.startsWith("folder:")) {
        parsed.folderFilter = lower.slice(7).trim() || null;
        return;
      }
      if (lower.startsWith("#")) {
        parsed.tagFilter = lower.slice(1).trim() || null;
        return;
      }
      if (lower.startsWith("is:")) {
        const value = lower.slice(3).trim();
        if (value === "pinned") {
          parsed.isPinned = true;
          return;
        }
        if (value === "unpinned") {
          parsed.isPinned = false;
          return;
        }
        if (value === "broken") {
          parsed.isBroken = true;
          return;
        }
        if (value === "alive") {
          parsed.isBroken = false;
          return;
        }
      }
      if (lower.startsWith("has:")) {
        const value = lower.slice(4).trim();
        if (value === "reader") {
          parsed.hasReader = true;
          return;
        }
      }
      if (lower.startsWith("date:")) {
        const dateExpression = lower.slice(5).trim();
        if (dateExpression.startsWith(">")) {
          const timestamp = parseDateOperand(dateExpression.slice(1));
          if (timestamp !== null) {
            parsed.dateAfter = timestamp;
            return;
          }
        } else if (dateExpression.startsWith("<")) {
          const timestamp = parseDateOperand(dateExpression.slice(1));
          if (timestamp !== null) {
            parsed.dateBefore = timestamp;
            return;
          }
        }
      }

      parsed.freeTerms.push(lower);
    });

    parsed.hasChosungTerms = parsed.freeTerms.some((term) => isChosungOnly(term));

    return parsed;
  }

  function parseDateOperand(input) {
    const value = String(input || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const date = new Date(`${value}T00:00:00`);
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function isChosungOnly(term) {
    return /^[ㄱ-ㅎ]+$/u.test(String(term || "").trim());
  }

  function extractChosungString(text) {
    const CHOSUNG = [
      "ㄱ",
      "ㄲ",
      "ㄴ",
      "ㄷ",
      "ㄸ",
      "ㄹ",
      "ㅁ",
      "ㅂ",
      "ㅃ",
      "ㅅ",
      "ㅆ",
      "ㅇ",
      "ㅈ",
      "ㅉ",
      "ㅊ",
      "ㅋ",
      "ㅌ",
      "ㅍ",
      "ㅎ"
    ];
    const source = String(text || "");
    let result = "";
    for (const char of source) {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const index = Math.floor((code - 0xac00) / 588);
        result += CHOSUNG[index] || "";
      } else if (/^[ㄱ-ㅎ]$/u.test(char)) {
        result += char;
      } else {
        result += " ";
      }
    }
    return result;
  }

  function matchesSearchTerm(corpusLower, chosungCorpus, term) {
    const safeTerm = String(term || "").trim().toLowerCase();
    if (!safeTerm) {
      return true;
    }
    if (corpusLower.includes(safeTerm)) {
      return true;
    }
    if (isChosungOnly(safeTerm) && chosungCorpus) {
      return chosungCorpus.includes(safeTerm);
    }
    return false;
  }

  function renderBookmarks() {
    pruneSelectedBookmarkIds();
    const all = getBookmarks().slice();
    const query = searchInput.value.trim();
    const parsedQuery = parseAdvancedSearchQuery(query);

    const filtered = all.filter((item) => {
      let pass = true;
      const folderName = normalizeFolderName(item.folder || "");

      if (smartFilter === "stale30") {
        const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
        if (item.visitedAt) {
          pass = pass && item.visitedAt < threshold;
        }
      }

      if (parsedQuery.domainFilter) {
        pass = pass && (item.domain || "").toLowerCase().includes(parsedQuery.domainFilter);
      }

      if (parsedQuery.tagFilter) {
        pass =
          pass &&
          (item.tags || []).some((tag) => tag.toLowerCase().includes(parsedQuery.tagFilter));
      }

      if (parsedQuery.folderFilter) {
        pass = pass && folderName.toLowerCase().includes(parsedQuery.folderFilter);
      }

      if (parsedQuery.isPinned !== null) {
        pass = pass && !!item.pinned === parsedQuery.isPinned;
      }

      if (parsedQuery.hasReader) {
        pass =
          pass &&
          !!(
            item.reader &&
            Array.isArray(item.reader.blocks) &&
            item.reader.blocks.some(
              (block) =>
                block && !String(block).includes("본문 텍스트를 충분히 추출하지 못했습니다.")
            )
          );
      }

      if (parsedQuery.dateAfter !== null) {
        pass = pass && (item.createdAt || 0) >= parsedQuery.dateAfter;
      }

      if (parsedQuery.dateBefore !== null) {
        pass = pass && (item.createdAt || 0) <= parsedQuery.dateBefore;
      }

      if (parsedQuery.isBroken !== null) {
        pass = pass && (!!item.linkHealth?.broken === parsedQuery.isBroken);
      }

      if (parsedQuery.freeTerms.length) {
        const readerText = Array.isArray(item.reader?.blocks) ? item.reader.blocks.join(" ") : "";
        const searchCorpus = `${item.name || ""} ${item.desc || ""} ${folderName} ${(item.tags || []).join(" ")} ${readerText}`.toLowerCase();
        const chosungCorpus = parsedQuery.hasChosungTerms
          ? extractChosungString(
              `${item.name || ""} ${item.desc || ""} ${folderName} ${(item.tags || []).join(" ")}`
            )
          : "";
        pass =
          pass &&
          parsedQuery.freeTerms.every((term) =>
            matchesSearchTerm(searchCorpus, chosungCorpus, term)
          );
      }

      if (selectedTags.length) {
        pass = pass && selectedTags.every((tag) => (item.tags || []).includes(tag));
      }

      if (selectedFolder) {
        pass =
          pass &&
          (folderName === selectedFolder || folderName.startsWith(`${selectedFolder}/`));
      }

      return pass;
    });

    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) {
        return -1;
      }
      if (!a.pinned && b.pinned) {
        return 1;
      }
      if (currentSort === "recentAdd") {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      if (currentSort === "recentVisit") {
        return (b.visitedAt || 0) - (a.visitedAt || 0);
      }
      if (currentSort === "frequent") {
        return (b.visitCount || 0) - (a.visitCount || 0);
      }
      return 0;
    });

    cleanupCardsSentinel();
    currentRenderItems = filtered;
    renderedBookmarkCount = 0;
    keyboardFocusedCardIndex = -1;
    cardsContainer.innerHTML = "";
    applyViewModeClass();

    if (!currentRenderItems.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const icon = document.createElement("div");
      icon.className = "empty-icon";
      icon.innerHTML = '<span class="material-symbols-outlined">bookmark</span>';
      empty.appendChild(icon);
      const text = document.createElement("p");
      text.textContent = query || selectedTags.length || selectedFolder
        ? "검색 결과가 없습니다. 다른 키워드를 사용해보세요."
        : "아직 저장된 사이트가 없습니다. 하단 버튼으로 추가해보세요.";
      empty.appendChild(text);
      cardsContainer.appendChild(empty);
      updateBulkBar();
      updateWorkspaceSummary(0);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      renderAllBookmarksAtOnce();
      updateBulkBar();
      updateWorkspaceSummary(filtered.length);
      return;
    }

    renderNextBookmarkBatch();
    updateBulkBar();
    updateWorkspaceSummary(filtered.length);
  }

  function renderAllBookmarksAtOnce() {
    const fragment = document.createDocumentFragment();
    currentRenderItems.forEach((item) => {
      fragment.appendChild(createBookmarkCard(item));
    });
    cardsContainer.appendChild(fragment);
    renderedBookmarkCount = currentRenderItems.length;
  }

  function renderNextBookmarkBatch() {
    if (!currentRenderItems.length) {
      cleanupCardsSentinel();
      return;
    }

    const nextItems = currentRenderItems.slice(
      renderedBookmarkCount,
      renderedBookmarkCount + RENDER_BATCH_SIZE
    );

    if (!nextItems.length) {
      cleanupCardsSentinel();
      return;
    }

    cleanupCardsSentinel();
    const fragment = document.createDocumentFragment();
    nextItems.forEach((item) => {
      fragment.appendChild(createBookmarkCard(item));
    });

    cardsContainer.appendChild(fragment);
    renderedBookmarkCount += nextItems.length;
    updateCardsSentinel();
  }

  function ensureCardsObserver() {
    if (cardsObserver || typeof IntersectionObserver === "undefined") {
      return;
    }

    cardsObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((entry) => entry.isIntersecting);
        if (!hit) {
          return;
        }
        renderNextBookmarkBatch();
      },
      {
        root: null,
        rootMargin: "280px 0px",
        threshold: 0
      }
    );
  }

  function cleanupCardsSentinel() {
    if (!cardsSentinel) {
      return;
    }

    if (cardsObserver) {
      cardsObserver.unobserve(cardsSentinel);
    }

    cardsSentinel.remove();
    cardsSentinel = null;
  }

  function updateCardsSentinel() {
    cleanupCardsSentinel();

    if (renderedBookmarkCount >= currentRenderItems.length) {
      return;
    }

    cardsSentinel = document.createElement("div");
    cardsSentinel.className = "cards-sentinel";
    cardsSentinel.textContent = `더 보기 (${renderedBookmarkCount}/${currentRenderItems.length})`;
    cardsContainer.appendChild(cardsSentinel);

    ensureCardsObserver();
    if (cardsObserver) {
      cardsObserver.observe(cardsSentinel);
    }
  }

  function createBookmarkCard(item) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = item.id;
    card.classList.toggle("selected", selectedBookmarkIds.has(item.id));
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      const ids = selectedBookmarkIds.has(item.id)
        ? Array.from(selectedBookmarkIds)
        : [item.id];
      draggingBookmarkIds = ids;
      card.classList.add("dragging");
      document.body.classList.add("dragging-bookmark");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", ids.join(","));
      }
    });
    card.addEventListener("dragend", () => {
      draggingBookmarkIds = [];
      card.classList.remove("dragging");
      document.body.classList.remove("dragging-bookmark");
      document.querySelectorAll(".folder-chip.drop-ready").forEach((chip) => {
        chip.classList.remove("drop-ready");
      });
    });

    const select = document.createElement("label");
    select.className = "card-select";
    select.title = "선택";

    const selectInput = document.createElement("input");
    selectInput.type = "checkbox";
    selectInput.checked = selectedBookmarkIds.has(item.id);
    selectInput.onchange = (event) => {
      event.stopPropagation();
      toggleBookmarkSelection(item.id, selectInput.checked);
      card.classList.toggle("selected", selectInput.checked);
    };
    select.appendChild(selectInput);
    card.appendChild(select);

    const pin = document.createElement("button");
    pin.className = "pin" + (item.pinned ? " pinned" : "");
    pin.type = "button";
    pin.innerHTML = `<span class="material-symbols-outlined">${
      item.pinned ? "star" : "radio_button_unchecked"
    }</span>`;
    pin.setAttribute("data-tooltip", item.pinned ? "고정 해제" : "상단 고정");
    pin.onclick = () => togglePin(item.id);
    card.appendChild(pin);

    const folderName = normalizeFolderName(item.folder || "");
    const folderMeta = getFolderMeta(folderName);
    const category = document.createElement("div");
    category.className = "card-category";
    category.textContent = folderName === DEFAULT_FOLDER_NAME ? "Bookmark" : folderName;
    if (folderMeta?.color) {
      category.style.color = folderMeta.color;
      category.style.borderColor = withHexAlpha(folderMeta.color, "66");
    }
    card.appendChild(category);

    card.appendChild(createCardMedia(item));

    const main = document.createElement("div");
    main.className = "card-main";

    const metaRow = document.createElement("div");
    metaRow.className = "card-meta-row";
    const domainLabel = document.createElement("p");
    domainLabel.className = "card-domain";
    domainLabel.textContent = item.domain || extractDomain(item.url) || "bookmark";
    metaRow.appendChild(domainLabel);
    const savedLabel = document.createElement("p");
    savedLabel.className = "card-saved";
    savedLabel.textContent = formatSavedAtLabel(item);
    metaRow.appendChild(savedLabel);
    main.appendChild(metaRow);

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = item.name || item.url;
    main.appendChild(title);

    if (item.desc) {
      const desc = document.createElement("div");
      desc.className = "card-desc";
      desc.textContent = item.desc;
      main.appendChild(desc);
    }

    if (item.tags && item.tags.length) {
      const tags = document.createElement("div");
      tags.className = "card-tags";
      item.tags.forEach((tag) => {
        const span = document.createElement("span");
        span.textContent = tag;
        tags.appendChild(span);
      });
      main.appendChild(tags);
    }

    if (item.linkHealth?.broken) {
      const brokenBadge = document.createElement("span");
      brokenBadge.className = "link-health-badge";
      const statusLabel = item.linkHealth.status ? ` ${item.linkHealth.status}` : "";
      brokenBadge.textContent = `Broken${statusLabel}`;
      main.appendChild(brokenBadge);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const leftActions = document.createElement("div");
    leftActions.className = "card-actions-left";

    const readButton = document.createElement("button");
    readButton.type = "button";
    readButton.innerHTML =
      '<span class="material-symbols-outlined">auto_stories</span><span class="sr-only">읽기</span>';
    readButton.setAttribute("data-tooltip", "읽기 모드");
    readButton.onclick = () => openReader(item.id);
    leftActions.appendChild(readButton);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.innerHTML =
      '<span class="material-symbols-outlined">edit_note</span><span class="sr-only">수정</span>';
    editButton.setAttribute("data-tooltip", "편집");
    editButton.onclick = () => openEdit(item.id);
    leftActions.appendChild(editButton);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.innerHTML =
      '<span class="material-symbols-outlined">delete</span><span class="sr-only">삭제</span>';
    deleteButton.setAttribute("data-tooltip", "삭제");
    deleteButton.onclick = () => deleteBookmark(item.id);
    leftActions.appendChild(deleteButton);

    actions.appendChild(leftActions);

    const openLink = document.createElement("a");
    openLink.href = item.url;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.className = "card-open-link";
    openLink.innerHTML = `<span>${getOpenLabel(item)}</span><span class="material-symbols-outlined">arrow_forward</span>`;
    openLink.setAttribute("data-tooltip", "원본 페이지 열기");
    openLink.onclick = () => {
      updateVisit(item.id);
    };
    actions.appendChild(openLink);

    main.appendChild(actions);
    card.appendChild(main);
    return card;
  }

  function formatSavedAtLabel(item) {
    const stamp = item.createdAt || item.updatedAt || 0;
    if (!stamp) {
      return "Saved recently";
    }
    const diffMs = Math.max(0, Date.now() - stamp);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    if (diffMs < day) {
      const hours = Math.max(1, Math.round(diffMs / hour));
      return `Saved ${hours}h ago`;
    }
    const days = Math.max(1, Math.round(diffMs / day));
    return `Saved ${days}d ago`;
  }

  function getOpenLabel(item) {
    if ((item.domain || "").includes("github.com")) {
      return "Open Repo";
    }
    if ((item.domain || "").includes("behance.net")) {
      return "Open Project";
    }
    return "Open Site";
  }

  function createCardMedia(item) {
    const media = document.createElement("div");
    media.className = "card-media";

    let fallbackCommitted = false;
    const appendLetterFallback = () => {
      if (fallbackCommitted) {
        return;
      }
      fallbackCommitted = true;
      media.classList.remove("has-media-favicon");
      const fallback = document.createElement("div");
      fallback.className = "fallback";
      fallback.textContent = (item.domain || item.name || "?").slice(0, 1).toUpperCase();
      media.appendChild(fallback);
    };

    const appendFaviconFallback = () => {
      if (fallbackCommitted) {
        return;
      }
      const faviconUrl = item.faviconUrl || buildFallbackFaviconUrl(item.url, item.domain);
      if (!faviconUrl) {
        appendLetterFallback();
        return;
      }
      media.classList.add("has-media-favicon");
      const favicon = document.createElement("img");
      favicon.className = "media-favicon";
      favicon.src = faviconUrl;
      favicon.alt = "";
      favicon.loading = "lazy";
      favicon.onerror = () => {
        favicon.remove();
        appendLetterFallback();
      };
      media.appendChild(favicon);
      fallbackCommitted = true;
    };

    if (item.thumbUrl) {
      const image = document.createElement("img");
      image.src = item.thumbUrl;
      image.alt = `${item.name || item.url} 썸네일`;
      image.loading = "lazy";
      image.onerror = () => {
        image.remove();
        appendFaviconFallback();
      };
      media.appendChild(image);
      return media;
    }

    appendFaviconFallback();
    if (!fallbackCommitted) {
      appendLetterFallback();
    }
    return media;
  }

  function buildFallbackFaviconUrl(url, domain) {
    const normalizedDomain = String(domain || extractDomain(url) || "").trim();
    if (!normalizedDomain) {
      return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    }
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalizedDomain)}&sz=64`;
  }

  function createFaviconImage(faviconUrl, url, domain) {
    const favicon = document.createElement("img");
    favicon.className = "card-favicon";
    favicon.src = faviconUrl || buildFallbackFaviconUrl(url, domain);
    favicon.alt = "";
    favicon.loading = "lazy";
    favicon.onerror = () => {
      const fallback = buildFallbackFaviconUrl(url, domain);
      if (favicon.src !== fallback) {
        favicon.src = fallback;
      }
    };
    return favicon;
  }

  function updateFolderSuggestions(folders) {
    if (!folderSuggestions) {
      return;
    }

    folderSuggestions.innerHTML = "";
    folders.slice(0, 120).forEach((folderName) => {
      const option = document.createElement("option");
      option.value = folderName;
      folderSuggestions.appendChild(option);
    });
  }

  function updateTagSuggestions(tags) {
    if (!tagSuggestions) {
      return;
    }

    tagSuggestions.innerHTML = "";
    tags.slice(0, 200).forEach((tagName) => {
      const option = document.createElement("option");
      option.value = tagName;
      tagSuggestions.appendChild(option);
    });
  }

  function pruneSelectedBookmarkIds() {
    if (!selectedBookmarkIds.size) {
      return;
    }

    const validIds = new Set(getBookmarks().map((item) => item.id));
    selectedBookmarkIds.forEach((id) => {
      if (!validIds.has(id)) {
        selectedBookmarkIds.delete(id);
      }
    });
  }

  function toggleBookmarkSelection(id, checked) {
    if (!id) {
      return;
    }

    if (checked) {
      selectedBookmarkIds.add(id);
    } else {
      selectedBookmarkIds.delete(id);
    }

    updateBulkBar();
  }

  function clearSelectedBookmarks() {
    if (!selectedBookmarkIds.size) {
      return;
    }
    selectedBookmarkIds.clear();
    renderBookmarks();
    updateBulkBar();
  }

  function toggleSelectVisibleBookmarks() {
    if (!currentRenderItems.length) {
      return;
    }

    const visibleIds = currentRenderItems.map((item) => item.id);
    const allVisibleSelected = visibleIds.every((id) => selectedBookmarkIds.has(id));

    visibleIds.forEach((id) => {
      if (allVisibleSelected) {
        selectedBookmarkIds.delete(id);
      } else {
        selectedBookmarkIds.add(id);
      }
    });

    renderBookmarks();
    updateBulkBar();
  }

  function updateBulkBar() {
    if (!bulkBar || !bulkCount) {
      updateWorkspaceSummary(currentRenderItems.length);
      return;
    }

    const selectedCount = selectedBookmarkIds.size;
    bulkBar.hidden = selectedCount === 0;
    bulkCount.textContent = `${selectedCount}개 선택됨`;

    if (bulkToggleVisibleBtn) {
      const visibleIds = currentRenderItems.map((item) => item.id);
      const visibleSelected = visibleIds.filter((id) => selectedBookmarkIds.has(id)).length;
      bulkToggleVisibleBtn.textContent =
        visibleIds.length > 0 && visibleSelected === visibleIds.length
          ? "현재 목록 선택 해제"
          : "현재 목록 전체 선택";
    }

    updateWorkspaceSummary(currentRenderItems.length);
  }

  function applyBulkMutation(mutator, doneMessage) {
    if (!selectedBookmarkIds.size) {
      showToast("먼저 사이트를 선택해주세요");
      return;
    }

    const data = getData();
    const selectedSet = new Set(selectedBookmarkIds);
    const now = Date.now();
    let changedCount = 0;

    data.bookmarks = data.bookmarks.map((item) => {
      if (!selectedSet.has(item.id)) {
        return item;
      }

      const patch = mutator(item);
      if (!patch) {
        return item;
      }

      changedCount += 1;
      return normalizeBookmark({
        ...item,
        ...patch,
        updatedAt: now
      });
    });

    if (!changedCount) {
      showToast("변경할 항목이 없습니다");
      return;
    }

    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    render();
    showToast(`${changedCount}개 ${doneMessage}`);
  }

  function moveBookmarksToFolderIds(ids, targetFolder, options = {}) {
    const normalizedFolder = normalizeFolderName(targetFolder);
    const idList = Array.isArray(ids) ? ids : [];
    const idSet = new Set(idList.filter((id) => id));
    if (!idSet.size) {
      return;
    }

    const data = getData();
    const now = Date.now();
    let movedCount = 0;

    data.bookmarks = data.bookmarks.map((item) => {
      if (!idSet.has(item.id)) {
        return item;
      }

      if (normalizeFolderName(item.folder || "") === normalizedFolder) {
        return item;
      }

      movedCount += 1;
      return normalizeBookmark({
        ...item,
        folder: normalizedFolder,
        updatedAt: now
      });
    });

    if (!movedCount) {
      return;
    }

    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    render();

    if (options.toastMessage) {
      showToast(String(options.toastMessage));
    } else {
      showToast(`${movedCount}개 폴더 이동 완료`);
    }
  }

  function bulkMoveToFolder() {
    if (!selectedBookmarkIds.size) {
      showToast("선택된 사이트가 없어요. 카드 왼쪽 체크박스로 먼저 골라주세요.");
      return;
    }

    openActionDialog({
      eyebrow: "대량 작업 · 폴더 이동",
      title: "선택한 사이트를 어느 폴더로 옮길까요?",
      description: "폴더 경로를 입력하면 선택한 사이트 전체에 한 번에 적용합니다.",
      label: "대상 폴더",
      defaultValue: selectedFolder || DEFAULT_FOLDER_NAME,
      placeholder: "예: 읽기/나중에",
      confirmText: "폴더 이동",
      summary: `${selectedBookmarkIds.size}개 사이트가 이동 대상입니다.`,
      onConfirm(value) {
        const normalizedFolder = normalizeFolderName(value);
        moveBookmarksToFolderIds(Array.from(selectedBookmarkIds), normalizedFolder);
        return true;
      }
    });
  }

  function bulkAddTags() {
    if (!selectedBookmarkIds.size) {
      showToast("선택된 사이트가 없어요. 카드 왼쪽 체크박스로 먼저 골라주세요.");
      return;
    }

    openActionDialog({
      eyebrow: "대량 작업 · 태그 추가",
      title: "선택한 사이트에 어떤 태그를 더할까요?",
      description: "띄어쓰기 또는 쉼표로 여러 태그를 한 번에 입력할 수 있습니다.",
      label: "추가할 태그",
      placeholder: "예: design, 읽기, 중요",
      confirmText: "태그 추가",
      summary: `${selectedBookmarkIds.size}개 사이트에 태그를 추가합니다.`,
      onConfirm(value) {
        const tagsToAdd = parseTags(value);
        if (!tagsToAdd.length) {
          showToast("추가할 태그가 없습니다");
          return false;
        }

        applyBulkMutation((item) => {
          const merged = Array.from(new Set([...(item.tags || []), ...tagsToAdd]));
          return { tags: merged };
        }, "태그 추가 완료");
        return true;
      }
    });
  }

  function bulkRemoveTags() {
    if (!selectedBookmarkIds.size) {
      showToast("선택된 사이트가 없어요. 카드 왼쪽 체크박스로 먼저 골라주세요.");
      return;
    }

    openActionDialog({
      eyebrow: "대량 작업 · 태그 제거",
      title: "선택한 사이트에서 어떤 태그를 뺄까요?",
      description: "지울 태그를 입력하면 선택된 사이트 전체에서 일괄 제거합니다.",
      label: "제거할 태그",
      placeholder: "예: design, 읽기",
      confirmText: "태그 제거",
      summary: `${selectedBookmarkIds.size}개 사이트에서 태그를 제거합니다.`,
      onConfirm(value) {
        const tagsToRemove = new Set(parseTags(value));
        if (!tagsToRemove.size) {
          showToast("제거할 태그가 없습니다");
          return false;
        }

        applyBulkMutation((item) => {
          const nextTags = (item.tags || []).filter((tag) => !tagsToRemove.has(tag));
          return { tags: nextTags };
        }, "태그 제거 완료");
        return true;
      }
    });
  }

  function bulkDeleteSelected() {
    if (!selectedBookmarkIds.size) {
      showToast("선택된 사이트가 없어요. 카드 왼쪽 체크박스로 먼저 골라주세요.");
      return;
    }

    openActionDialog({
      eyebrow: "위험 작업",
      title: `선택한 ${selectedBookmarkIds.size}개 사이트를 삭제할까요?`,
      description: "삭제하면 동기화용 tombstone도 함께 기록됩니다. 신중하게 진행해주세요.",
      hideInput: true,
      confirmText: "삭제",
      summary: "선택한 항목만 일괄 삭제됩니다.",
      onConfirm() {
        const selectedSet = new Set(selectedBookmarkIds);
        const data = getData();
        const now = Date.now();
        let deletedCount = 0;

        data.bookmarks = data.bookmarks.filter((item) => {
          if (!selectedSet.has(item.id)) {
            return true;
          }
          deletedCount += 1;
          upsertTombstone(data, item.id, now);
          return false;
        });

        if (!deletedCount) {
          return true;
        }

        data.updatedAt = now;
        saveData(data, { touch: false });
        scheduleAutoSync();
        selectedBookmarkIds.clear();
        deletedItem = null;
        render();
        showToast(`${deletedCount}개 삭제했습니다`);
        return true;
      }
    });
  }

  function isEditableElement(target) {
    if (!target || !(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      target.isContentEditable
    );
  }

  function focusSearchInput() {
    searchInput.focus();
    searchInput.select();
  }

  function moveKeyboardCardFocus(direction) {
    let cards = Array.from(cardsContainer.querySelectorAll(".card"));
    if (!cards.length) {
      return;
    }

    if (
      direction > 0 &&
      keyboardFocusedCardIndex >= cards.length - 1 &&
      renderedBookmarkCount < currentRenderItems.length
    ) {
      renderNextBookmarkBatch();
      cards = Array.from(cardsContainer.querySelectorAll(".card"));
    }

    if (keyboardFocusedCardIndex < 0) {
      keyboardFocusedCardIndex = direction > 0 ? 0 : cards.length - 1;
    } else {
      keyboardFocusedCardIndex = Math.max(
        0,
        Math.min(cards.length - 1, keyboardFocusedCardIndex + direction)
      );
    }

    cards.forEach((card, index) => {
      card.classList.toggle("keyboard-focus", index === keyboardFocusedCardIndex);
    });

    cards[keyboardFocusedCardIndex]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
  }

  function activateKeyboardFocusedCard() {
    const cards = Array.from(cardsContainer.querySelectorAll(".card"));
    if (
      keyboardFocusedCardIndex < 0 ||
      keyboardFocusedCardIndex >= cards.length
    ) {
      return false;
    }

    const card = cards[keyboardFocusedCardIndex];
    const openLink = card.querySelector(".card-actions a");
    if (!openLink) {
      return false;
    }

    openLink.click();
    return true;
  }

  function handleKeyboardShortcuts(event) {
    const key = event.key;
    const lowerKey = key.toLowerCase();
    const editing = isEditableElement(event.target);
    const hasMeta = event.ctrlKey || event.metaKey;

    if (hasMeta && lowerKey === "f") {
      event.preventDefault();
      focusSearchInput();
      return true;
    }

    if (key === "/" && !editing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      focusSearchInput();
      return true;
    }

    if (hasMeta && lowerKey === "enter") {
      const sheetOpened = sheetOverlay?.style.display === "flex";
      if (sheetOpened && step2.classList.contains("active")) {
        event.preventDefault();
        saveBookmarkFromSheet();
        return true;
      }
      return false;
    }

    if (editing) {
      return false;
    }

    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveKeyboardCardFocus(key === "ArrowDown" ? 1 : -1);
      return true;
    }

    if (key === "Enter") {
      if (activateKeyboardFocusedCard()) {
        event.preventDefault();
        return true;
      }
    }

    return false;
  }

  function toggleTagFilter(tag) {
    const index = selectedTags.indexOf(tag);
    if (index >= 0) {
      selectedTags.splice(index, 1);
    } else {
      selectedTags.push(tag);
    }
    smartFilter = "";
    renderBookmarks();
    renderTagFilters();
    closeSidePanelOnCompact();
  }

  function initializeTagChipInput() {
    if (!siteTagsChipBox || !siteTagsEditor || !siteTagsInput) {
      return;
    }

    renderTagChipTokens();

    siteTagsChipBox.addEventListener("click", () => {
      siteTagsEditor.focus();
    });

    siteTagsEditor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "," || event.key === " ") {
        event.preventDefault();
        commitTagEditorBuffer();
        return;
      }

      if (event.key === "Backspace" && !siteTagsEditor.value.trim() && sheetTagTokens.length) {
        event.preventDefault();
        sheetTagTokens.pop();
        syncSheetTagInputFromTokens();
        renderTagChipTokens();
      }
    });

    siteTagsEditor.addEventListener("blur", () => {
      commitTagEditorBuffer();
    });
  }

  function commitTagEditorBuffer() {
    if (!siteTagsEditor) {
      return;
    }

    const parsed = parseTags(siteTagsEditor.value.replace(/,/g, " "));
    if (!parsed.length) {
      siteTagsEditor.value = "";
      return;
    }

    const merged = Array.from(new Set([...sheetTagTokens, ...parsed]));
    setSheetTags(merged);
    siteTagsEditor.value = "";
  }

  function setSheetTags(tags) {
    sheetTagTokens = parseTags(Array.isArray(tags) ? tags.join(" ") : String(tags || ""));
    if (siteTagsEditor) {
      siteTagsEditor.value = "";
    }
    syncSheetTagInputFromTokens();
    renderTagChipTokens();
  }

  function syncSheetTagInputFromTokens() {
    if (!siteTagsInput) {
      return;
    }
    siteTagsInput.value = sheetTagTokens.join(" ");
  }

  function renderTagChipTokens() {
    if (!siteTagsChipBox || !siteTagsEditor) {
      return;
    }

    siteTagsChipBox
      .querySelectorAll(".tag-chip-token")
      .forEach((tokenEl) => tokenEl.remove());

    sheetTagTokens.forEach((tag) => {
      const token = document.createElement("span");
      token.className = "tag-chip-token";
      token.textContent = tag;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title = `${tag} 제거`;
      removeBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        sheetTagTokens = sheetTagTokens.filter((value) => value !== tag);
        syncSheetTagInputFromTokens();
        renderTagChipTokens();
      };
      token.appendChild(removeBtn);

      siteTagsChipBox.insertBefore(token, siteTagsEditor);
    });
  }

  function openSettings() {
    if (!settingsOverlay) {
      return;
    }

    renderFolderStyleControls();
    closeSidePanel();
    settingsOverlay.hidden = false;
    requestAnimationFrame(() => {
      settingsOverlay.classList.add("open");
    });
  }

  function closeSettings() {
    if (!settingsOverlay || settingsOverlay.hidden) {
      return;
    }

    settingsOverlay.classList.remove("open");
    setTimeout(() => {
      if (!settingsOverlay.classList.contains("open")) {
        settingsOverlay.hidden = true;
      }
    }, 250);
  }

  function updateSheetProgress(step) {
    if (!sheetProgress) {
      return;
    }
    sheetProgress.textContent =
      step === 2
        ? "2 / 2 단계 · 이름·폴더·태그 정리"
        : "1 / 2 단계 · URL 입력";
  }

  function closeActionDialog() {
    pendingActionDialog = null;
    if (actionDialogOverlay) {
      actionDialogOverlay.hidden = true;
    }
    if (actionDialogInput) {
      actionDialogInput.value = "";
    }
  }

  function openActionDialog(options) {
    if (
      !actionDialogOverlay ||
      !actionDialogTitle ||
      !actionDialogDescription ||
      !actionDialogSummary ||
      !actionDialogConfirmBtn ||
      !actionDialogInput ||
      !actionDialogLabel
    ) {
      return;
    }

    pendingActionDialog = {
      onConfirm: options.onConfirm
    };

    if (actionDialogEyebrow) {
      actionDialogEyebrow.textContent = options.eyebrow || "선택한 항목 작업";
    }
    actionDialogTitle.textContent = options.title || "작업 확인";
    actionDialogDescription.textContent = options.description || "";
    actionDialogSummary.textContent = options.summary || "";
    actionDialogLabel.textContent = options.label || "입력";
    actionDialogInput.value = options.defaultValue || "";
    actionDialogInput.placeholder = options.placeholder || "";
    actionDialogInput.hidden = !!options.hideInput;
    actionDialogLabel.hidden = !!options.hideInput;
    actionDialogConfirmBtn.textContent = options.confirmText || "확인";
    actionDialogOverlay.hidden = false;

    setTimeout(() => {
      if (options.hideInput) {
        actionDialogConfirmBtn.focus();
      } else {
        actionDialogInput.focus();
        actionDialogInput.select();
      }
    }, 0);
  }

  async function submitActionDialog() {
    if (!pendingActionDialog?.onConfirm) {
      closeActionDialog();
      return;
    }

    const value = actionDialogInput?.value || "";
    const handler = pendingActionDialog.onConfirm;
    const shouldClose = await handler(value);
    if (shouldClose !== false) {
      closeActionDialog();
    }
  }

  function openAdd() {
    sheetMode = "add";
    editId = null;
    sheetTitle.textContent = "새 사이트 추가";

    siteUrlInput.value = "";
    siteNameInput.value = "";
    if (siteFolderInput) {
      siteFolderInput.value = DEFAULT_FOLDER_NAME;
    }
    if (siteThumbUrlInput) {
      siteThumbUrlInput.value = "";
    }
    if (siteFaviconUrlInput) {
      siteFaviconUrlInput.value = "";
    }
    setSheetTags([]);
    siteDescInput.value = "";
    setMetadataPreview(null);
    setMetadataHint("1단계에서 URL을 확인하면 2단계에서 제목·폴더·태그를 바로 정리할 수 있어요.");

    step1.classList.add("active");
    step2.classList.remove("active");
    updateSheetProgress(1);

    sheetOverlay.style.display = "flex";
    setTimeout(() => sheet.classList.add("open"), 10);
  }

  function openAddPrefilled(url, name) {
    sheetMode = "add";
    editId = null;
    sheetTitle.textContent = "새 사이트 추가";

    siteUrlInput.value = url || "";
    siteNameInput.value = name || suggestName(url || "");
    if (siteFolderInput) {
      siteFolderInput.value = DEFAULT_FOLDER_NAME;
    }
    if (siteThumbUrlInput) {
      siteThumbUrlInput.value = "";
    }
    if (siteFaviconUrlInput) {
      siteFaviconUrlInput.value = "";
    }
    setSheetTags([]);
    siteDescInput.value = "";
    setMetadataPreview(null);
    setMetadataHint("주소를 확인한 뒤 이름·폴더·태그를 바로 정리하세요.");

    step1.classList.remove("active");
    step2.classList.add("active");
    updateSheetProgress(2);

    sheetOverlay.style.display = "flex";
    setTimeout(() => sheet.classList.add("open"), 10);
    if (url) {
      autofillMetadataFromUrl(url);
    }
  }

  function openEdit(id) {
    const data = getData();
    const item = data.bookmarks.find((bookmark) => bookmark.id === id);
    if (!item) {
      return;
    }

    sheetMode = "edit";
    editId = id;
    sheetTitle.textContent = "사이트 수정";

    siteUrlInput.value = item.url;
    siteNameInput.value = item.name || "";
    if (siteFolderInput) {
      siteFolderInput.value = normalizeFolderName(item.folder || "");
    }
    if (siteThumbUrlInput) {
      siteThumbUrlInput.value = item.thumbUrl || "";
    }
    if (siteFaviconUrlInput) {
      siteFaviconUrlInput.value = item.faviconUrl || "";
    }
    setSheetTags(item.tags || []);
    siteDescInput.value = item.desc || "";
    setMetadataPreview({
      image: item.thumbUrl || "",
      favicon: item.faviconUrl || "",
      description: item.desc || "",
      domain: item.domain || extractDomain(item.url)
    });
    setMetadataHint("기존 정보를 검토하고 필요한 값만 빠르게 수정하세요.");

    step1.classList.remove("active");
    step2.classList.add("active");
    updateSheetProgress(2);

    sheetOverlay.style.display = "flex";
    setTimeout(() => sheet.classList.add("open"), 10);
  }

  function closeSheet() {
    sheet.classList.remove("open");
    setTimeout(() => {
      sheetOverlay.style.display = "none";
    }, 250);
  }

  function setMetadataPreview(metadata) {
    if (!metadataPreview) {
      return;
    }
    setMetadataLoading(false);

    if (!metadata || (!metadata.image && !metadata.favicon && !metadata.description && !metadata.domain)) {
      metadataPreview.hidden = true;
      if (metadataThumb) {
        metadataThumb.src = "";
        metadataThumb.style.display = "none";
      }
      if (metadataFavicon) {
        metadataFavicon.src = "";
        metadataFavicon.style.display = "none";
      }
      if (metadataDomain) {
        metadataDomain.textContent = "";
      }
      if (metadataDescription) {
        metadataDescription.textContent = "";
      }
      return;
    }

    metadataPreview.hidden = false;
    if (metadataThumb) {
      metadataThumb.src = metadata.image || "";
      metadataThumb.style.display = metadata.image ? "block" : "none";
    }
    if (metadataFavicon) {
      metadataFavicon.src = metadata.favicon || "";
      metadataFavicon.style.display = metadata.favicon ? "block" : "none";
    }
    if (metadataDomain) {
      metadataDomain.textContent = metadata.domain || "";
    }
    if (metadataDescription) {
      metadataDescription.textContent = metadata.description || "설명 정보를 찾지 못했습니다.";
    }
  }

  function setMetadataHint(text) {
    if (!metadataHint) {
      return;
    }
    metadataHint.textContent = text;
  }

  function setMetadataLoading(isLoading) {
    if (metadataSkeleton) {
      metadataSkeleton.hidden = !isLoading;
    }
    if (isLoading && metadataPreview) {
      metadataPreview.hidden = true;
    }
  }

  async function autofillMetadataFromUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      return;
    }

    const requestId = Date.now() + Math.random();
    metadataRequestInFlight = requestId;
    setMetadataLoading(true);
    setMetadataHint("주소를 불러오는 중... 잠시만 기다려주세요.");
    if (nextBtn) {
      nextBtn.disabled = true;
    }

    try {
      const metadata = await extractMetadataForUrl(normalized);
      if (metadataRequestInFlight !== requestId) {
        return;
      }

      const currentName = (siteNameInput?.value || "").trim();
      if (!currentName || currentName === suggestName(normalized)) {
        siteNameInput.value = metadata.title || suggestName(normalized);
      }
      if (siteDescInput && !siteDescInput.value.trim()) {
        siteDescInput.value = metadata.description || "";
      }
      if (siteThumbUrlInput && !siteThumbUrlInput.value.trim()) {
        siteThumbUrlInput.value = metadata.image || "";
      }
      if (siteFaviconUrlInput && !siteFaviconUrlInput.value.trim()) {
        siteFaviconUrlInput.value = metadata.favicon || "";
      }
      if (siteFolderInput && !siteFolderInput.value.trim()) {
        siteFolderInput.value = DEFAULT_FOLDER_NAME;
      }

      setMetadataPreview(metadata);
      setMetadataHint("제목·대표 이미지·설명을 자동으로 채웠어요.");
    } catch (_error) {
      if (metadataRequestInFlight !== requestId) {
        return;
      }
      setMetadataHint("자동 추출에 실패했어요. 이름과 설명은 직접 넣어도 됩니다.");
    } finally {
      if (metadataRequestInFlight === requestId) {
        setMetadataLoading(false);
      }
      if (metadataRequestInFlight === requestId && nextBtn) {
        nextBtn.disabled = false;
      }
    }
  }

  async function extractMetadataForUrl(url) {
    const html = await fetchHtmlWithFallback(url);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = pickFirstMeta(doc, [
      ['meta[property="og:title"]', "content"],
      ['meta[name="twitter:title"]', "content"],
      ["title", "textContent"]
    ]) || suggestName(url);
    const description =
      pickFirstMeta(doc, [
        ['meta[property="og:description"]', "content"],
        ['meta[name="description"]', "content"],
        ['meta[name="twitter:description"]', "content"]
      ]) || "";
    const image = normalizeAssetUrl(
      pickFirstMeta(doc, [
        ['meta[property="og:image"]', "content"],
        ['meta[name="twitter:image"]', "content"]
      ]),
      url
    );
    const faviconFromMeta = normalizeAssetUrl(
      pickFirstMeta(doc, [
        ['link[rel="icon"]', "href"],
        ['link[rel="shortcut icon"]', "href"],
        ['link[rel="apple-touch-icon"]', "href"]
      ]),
      url
    );
    const favicon = faviconFromMeta || buildFallbackFaviconUrl(url, extractDomain(url));

    return {
      title,
      description,
      image,
      favicon,
      domain: extractDomain(url)
    };
  }

  async function fetchHtmlWithFallback(url) {
    const candidates = [];
    if (IS_EXTENSION_CONTEXT) {
      candidates.push(url);
    }
    candidates.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    candidates.push(`https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`);

    let lastError = null;
    for (const endpoint of candidates) {
      try {
        const response = await fetch(endpoint, { method: "GET" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        if (text && text.length > 80) {
          return text;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("페이지를 불러오지 못했습니다");
  }

  function pickFirstMeta(doc, rules) {
    for (const [selector, attribute] of rules) {
      const element = doc.querySelector(selector);
      if (!element) {
        continue;
      }
      const value =
        attribute === "textContent"
          ? (element.textContent || "").trim()
          : (element.getAttribute(attribute) || "").trim();
      if (value) {
        return value;
      }
    }
    return "";
  }

  async function openReader(id) {
    if (!readerOverlay || !readerTitle || !readerBody || !readerImages || !readerSubline) {
      return;
    }

    const data = getData();
    const item = data.bookmarks.find((bookmark) => bookmark.id === id);
    if (!item) {
      return;
    }

    readerOverlay.hidden = false;
    readerTitle.textContent = item.name || item.url;
    readerSubline.textContent = "본문을 불러오는 중...";
    readerImages.innerHTML = "";
    readerBody.innerHTML = "<p>읽기 모드를 준비하고 있습니다...</p>";
    if (readerOpenOriginal) {
      readerOpenOriginal.href = item.url;
    }

    try {
      const readerData = item.reader || (await extractReaderContent(item.url));
      renderReader(item, readerData);

      if (!item.reader) {
        const index = data.bookmarks.findIndex((bookmark) => bookmark.id === id);
        if (index >= 0) {
          data.bookmarks[index] = normalizeBookmark({
            ...data.bookmarks[index],
            reader: readerData,
            updatedAt: Date.now()
          });
          data.updatedAt = Date.now();
          saveData(data, { touch: false });
          scheduleAutoSync();
        }
      }
    } catch (_error) {
      readerSubline.textContent = "읽기 모드 추출 실패";
      readerBody.innerHTML = "<p>본문 추출에 실패했습니다. 원문 열기를 이용해주세요.</p>";
    }
  }

  function closeReader() {
    if (!readerOverlay) {
      return;
    }
    readerOverlay.hidden = true;
  }

  function renderReader(item, readerData) {
    if (!readerTitle || !readerBody || !readerImages || !readerSubline) {
      return;
    }

    readerTitle.textContent = readerData.title || item.name || item.url;
    readerSubline.textContent = `${extractDomain(item.url)} · ${new Date(
      readerData.extractedAt || Date.now()
    ).toLocaleString()}`;
    readerImages.innerHTML = "";
    readerBody.innerHTML = "";

    (readerData.images || []).forEach((imageUrl) => {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      readerImages.appendChild(image);
    });

    (readerData.blocks || []).forEach((block) => {
      const p = document.createElement("p");
      p.textContent = block;
      readerBody.appendChild(p);
    });
  }

  async function extractReaderContent(url) {
    const html = await fetchHtmlWithFallback(url);
    const doc = new DOMParser().parseFromString(html, "text/html");

    doc.querySelectorAll("script, style, noscript, header, footer, nav, aside, form").forEach((el) => {
      el.remove();
    });

    const rootCandidates = [
      doc.querySelector("article"),
      doc.querySelector("main"),
      doc.querySelector("[role='main']"),
      doc.querySelector(".markdown-body"),
      doc.querySelector(".entry-content"),
      doc.querySelector(".post-content"),
      doc.querySelector(".article-body"),
      doc.querySelector("#readme")
    ].filter((node) => !!node);

    const primaryRoot = rootCandidates[0] || doc.body;

    let blocks = [];
    for (const root of rootCandidates.length ? rootCandidates : [primaryRoot]) {
      blocks = extractReaderBlocksFromRoot(root);
      if (blocks.length >= 4) {
        break;
      }
    }

    if (blocks.length < 3) {
      blocks = extractReaderTextFallback(html, doc);
    }

    const images = Array.from(primaryRoot.querySelectorAll("img"))
      .map((img) => normalizeAssetUrl(img.getAttribute("src") || "", url))
      .filter((src, index, arr) => src && arr.indexOf(src) === index)
      .slice(0, 8);

    return {
      title:
        pickFirstMeta(doc, [
          ['meta[property="og:title"]', "content"],
          ["title", "textContent"]
        ]) || suggestName(url),
      blocks: blocks.length
        ? blocks
        : ["본문 텍스트를 충분히 추출하지 못했습니다. 원문 열기로 확인해주세요."],
      images,
      extractedAt: Date.now()
    };
  }

  function extractReaderBlocksFromRoot(root) {
    if (!root) {
      return [];
    }

    const seen = new Set();
    return Array.from(root.querySelectorAll("p, li, h1, h2, h3, pre"))
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((text) => text.length >= 26)
      .filter((text) => {
        if (seen.has(text)) {
          return false;
        }
        seen.add(text);
        return true;
      })
      .slice(0, 60);
  }

  function extractReaderTextFallback(html, doc) {
    const metaDescription =
      pickFirstMeta(doc, [
        ['meta[property="og:description"]', "content"],
        ['meta[name="description"]', "content"]
      ]) || "";

    const textOnly = String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const rawParts = textOnly.split(/(?<=[.!?])\s+/).filter((part) => part.length >= 45);
    const blocks = rawParts.slice(0, 40);

    if (metaDescription && !blocks.length) {
      return [metaDescription];
    }

    if (metaDescription && blocks.length) {
      blocks.unshift(metaDescription);
    }

    return Array.from(new Set(blocks)).slice(0, 40);
  }

  function saveBookmarkFromSheet() {
    commitTagEditorBuffer();
    const normalizedUrl = normalizeUrl(siteUrlInput.value.trim());
    let name = siteNameInput.value.trim();
    const folder = normalizeFolderName((siteFolderInput?.value || "").trim());
    const thumbUrl = normalizeAssetUrl(siteThumbUrlInput?.value || "");
    const faviconUrl = normalizeAssetUrl(siteFaviconUrlInput?.value || "");
    const tags = parseTags(siteTagsInput.value);
    const desc = siteDescInput.value.trim();

    if (!normalizedUrl) {
      alert("올바른 URL을 입력해주세요");
      return;
    }

    if (!name) {
      name = suggestName(normalizedUrl);
    }

    const now = Date.now();
    const data = getData();

    if (sheetMode === "add") {
      const exists = data.bookmarks.find((item) => item.url === normalizedUrl);
      if (exists) {
        showToast("이미 저장된 사이트입니다. 수정 화면으로 이동합니다");
        openEdit(exists.id);
        return;
      }

      const newItem = normalizeBookmark({
        id: generateId(),
        url: normalizedUrl,
        name,
        folder,
        thumbUrl,
        faviconUrl,
        tags,
        desc,
        createdAt: now,
        updatedAt: now,
        pinned: false,
        visitCount: 0,
        visitedAt: null,
        domain: extractDomain(normalizedUrl)
      });

      data.bookmarks.push(newItem);
      removeTombstone(data, newItem.id);
      data.updatedAt = now;
      saveData(data, { touch: false });
      scheduleAutoSync();
      showToast("저장했어요");
    } else if (sheetMode === "edit" && editId) {
      const index = data.bookmarks.findIndex((item) => item.id === editId);
      if (index >= 0) {
        const original = data.bookmarks[index];
        data.bookmarks[index] = normalizeBookmark({
          ...original,
          url: normalizedUrl,
          name,
          folder,
          thumbUrl,
          faviconUrl,
          tags,
          desc,
          domain: extractDomain(normalizedUrl),
          updatedAt: now
        });
        removeTombstone(data, editId);
        data.updatedAt = now;
        saveData(data, { touch: false });
        scheduleAutoSync();
        showToast("수정했습니다");
      }
    }

    if (navigator.vibrate) {
      navigator.vibrate(10);
    }

    closeSheet();
    render();
  }

  function deleteBookmark(id) {
    const data = getData();
    const index = data.bookmarks.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const now = Date.now();
    const item = data.bookmarks[index];

    deletedItem = {
      item: { ...item },
      index
    };

    data.bookmarks.splice(index, 1);
    upsertTombstone(data, item.id, now);
    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    selectedBookmarkIds.delete(id);

    render();
    showToast("삭제했습니다", { undo: true });

    if (undoTimeout) {
      clearTimeout(undoTimeout);
    }

    undoTimeout = setTimeout(() => {
      deletedItem = null;
      undoTimeout = null;
    }, 5000);
  }

  function undoDelete() {
    if (!deletedItem) {
      return;
    }

    const data = getData();
    const now = Date.now();
    const restoredItem = normalizeBookmark({
      ...deletedItem.item,
      updatedAt: now
    });

    const index = Math.min(Math.max(deletedItem.index, 0), data.bookmarks.length);
    data.bookmarks.splice(index, 0, restoredItem);
    removeTombstone(data, restoredItem.id);
    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();

    deletedItem = null;
    if (undoTimeout) {
      clearTimeout(undoTimeout);
      undoTimeout = null;
    }

    render();
    showToast("복원했습니다");
  }

  function updateVisit(id) {
    const data = getData();
    const index = data.bookmarks.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const now = Date.now();
    const item = data.bookmarks[index];

    data.bookmarks[index] = normalizeBookmark({
      ...item,
      visitCount: (item.visitCount || 0) + 1,
      visitedAt: now,
      updatedAt: now
    });

    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    renderBookmarks();

    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }

  function togglePin(id) {
    const data = getData();
    const index = data.bookmarks.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const now = Date.now();
    const item = data.bookmarks[index];
    data.bookmarks[index] = normalizeBookmark({
      ...item,
      pinned: !item.pinned,
      updatedAt: now
    });

    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    renderBookmarks();
  }

  function showToast(message, options = {}) {
    if (!toastContainer) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    if (options.undo) {
      const button = document.createElement("button");
      button.textContent = "되돌리기";
      button.onclick = () => {
        undoDelete();
        toast.remove();
      };
      toast.appendChild(button);
    }

    toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3000);
  }

  function exportData() {
    const data = getData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bookmarks-backup.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
    showToast("백업 파일을 다운로드했어요");
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const imported = JSON.parse(loadEvent.target.result);
        const normalized = normalizeData(imported);

        if (!confirm("기존 데이터를 덮어쓰시겠어요?")) {
          return;
        }

        normalized.updatedAt = Date.now();
        saveData(normalized, { touch: false });
        scheduleAutoSync();
        render();
        showToast("데이터를 복구했어요");
      } catch (_error) {
        alert("백업 파일을 읽지 못했습니다");
      }
    };

    reader.readAsText(file);
    importFileInput.value = "";
  }

  function getBookmarkletCode() {
    const current = new URL(window.location.href);
    current.search = "";
    current.hash = "";

    const base = current.toString();
    const safeBase = JSON.stringify(base);

    return `javascript:(function(){var u=encodeURIComponent(location.href);var t=encodeURIComponent(document.title);window.open(${safeBase}+'?url='+u+'&name='+t,'_blank');})();`;
  }

  function copyBookmarkletCode() {
    const code = getBookmarkletCode();

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(
        () => {
          showToast("북마클릿 코드가 복사되었어요");
        },
        () => {
          prompt("아래 코드를 복사해 북마클릿으로 저장하세요.", code);
        }
      );
      return;
    }

    prompt("아래 코드를 복사해 북마클릿으로 저장하세요.", code);
  }

  function copyBookmarkLink(item) {
    if (!item || !item.url) {
      return;
    }

    const title = (item.name || item.url).replace(/\]/g, "\\]");
    const markdown = `[${title}](${item.url})`;
    const plain = item.url;
    const payload = `${markdown}\n${plain}`;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(payload).then(
        () => {
          showToast("링크를 복사했어요");
        },
        () => {
          prompt("아래 텍스트를 복사하세요.", payload);
        }
      );
      return;
    }

    prompt("아래 텍스트를 복사하세요.", payload);
  }

  function scheduleDeadLinkCheck() {
    if (deadLinkCheckScheduled || deadLinkCheckInFlight) {
      return;
    }

    deadLinkCheckScheduled = true;
    const runner = () => {
      deadLinkCheckScheduled = false;
      runDeadLinkCheckBatch().catch(() => {});
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(runner, { timeout: 6000 });
      return;
    }

    setTimeout(runner, 2200);
  }

  function shouldCheckLinkHealth(item, now, force) {
    if (!item || !item.url) {
      return false;
    }
    if (force) {
      return true;
    }
    if (now - (item.createdAt || 0) < LINK_CHECK_MIN_AGE_MS) {
      return false;
    }
    const checkedAt = item.linkHealth?.checkedAt || 0;
    return now - checkedAt >= LINK_CHECK_RECHECK_MS;
  }

  async function runDeadLinkCheckBatch(options = {}) {
    if (deadLinkCheckInFlight) {
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }

    deadLinkCheckInFlight = true;
    const force = options.force === true;
    const full = options.full === true;
    const now = Date.now();
    const limit = full ? 30 : LINK_CHECK_BATCH_SIZE;

    try {
      const data = getData();
      const candidates = data.bookmarks
        .filter((item) => shouldCheckLinkHealth(item, now, force))
        .sort((a, b) => (a.linkHealth?.checkedAt || 0) - (b.linkHealth?.checkedAt || 0))
        .slice(0, limit);

      if (!candidates.length) {
        if (full) {
          showToast("검사할 오래된 링크가 없습니다");
        }
        return;
      }

      let changed = false;
      for (const item of candidates) {
        const probed = await probeLinkHealth(item.url);
        if (!probed) {
          continue;
        }

        const index = data.bookmarks.findIndex((bookmark) => bookmark.id === item.id);
        if (index < 0) {
          continue;
        }

        const nextHealth = {
          checkedAt: Date.now(),
          status: probed.status,
          broken: probed.broken
        };
        const prevHealth = data.bookmarks[index].linkHealth || null;
        const same =
          prevHealth &&
          prevHealth.status === nextHealth.status &&
          prevHealth.broken === nextHealth.broken &&
          Math.abs((prevHealth.checkedAt || 0) - nextHealth.checkedAt) < 1000;

        if (same) {
          continue;
        }

        data.bookmarks[index] = normalizeBookmark({
          ...data.bookmarks[index],
          linkHealth: nextHealth,
          updatedAt: Date.now()
        });
        changed = true;
      }

      if (changed) {
        data.updatedAt = Date.now();
        saveData(data, { touch: false });
        scheduleAutoSync();
        renderBookmarks();
      }

      if (!full) {
        scheduleDeadLinkCheck();
      } else {
        showToast("죽은 링크 검사 완료");
      }
    } finally {
      deadLinkCheckInFlight = false;
    }
  }

  async function probeLinkHealth(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      return null;
    }

    const timeoutMs = 8000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const headResponse = await fetch(normalized, {
        method: "HEAD",
        redirect: "follow",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      if (headResponse.type === "opaque") {
        return null;
      }
      const status = headResponse.status || 0;
      if (status === 405 || status === 501) {
        const getResponse = await fetch(normalized, {
          method: "GET",
          redirect: "follow",
          cache: "no-store",
          signal: controller ? controller.signal : undefined
        });
        const getStatus = getResponse.type === "opaque" ? 0 : getResponse.status || 0;
        return {
          status: getStatus,
          broken: getStatus >= 400
        };
      }
      return {
        status,
        broken: status >= 400
      };
    } catch (_error) {
      return null;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  function deleteBrokenLinks() {
    const data = getData();
    const brokenIds = data.bookmarks
      .filter((item) => item.linkHealth?.broken)
      .map((item) => item.id);

    if (!brokenIds.length) {
      showToast("삭제할 죽은 링크가 없습니다");
      return;
    }

    if (!confirm(`죽은 링크 ${brokenIds.length}개를 삭제할까요?`)) {
      return;
    }

    const idSet = new Set(brokenIds);
    const now = Date.now();
    data.bookmarks = data.bookmarks.filter((item) => {
      if (!idSet.has(item.id)) {
        return true;
      }
      upsertTombstone(data, item.id, now);
      return false;
    });

    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    render();
    showToast(`${brokenIds.length}개 삭제했습니다`);
  }

  function checkIncomingUrl() {
    if (IS_EXTENSION_CONTEXT) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_callback") === "1") {
      return;
    }

    if (!params.has("url")) {
      return;
    }

    const urlParam = params.get("url") || "";
    const nameParam = params.get("name") || "";
    const normalized = normalizeUrl(urlParam);

    if (!normalized) {
      return;
    }

    openAddPrefilled(normalized, nameParam || suggestName(normalized));
    history.replaceState(null, "", window.location.pathname);
  }

  function captureCurrentTabToSheet() {
    if (!IS_EXTENSION_CONTEXT || !chrome.tabs?.query) {
      showToast("현재 탭 추가는 확장프로그램에서만 지원됩니다");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      const tabUrl = tab?.url || "";

      if (!tabUrl || !normalizeUrl(tabUrl)) {
        showToast("이 탭은 URL을 읽을 수 없습니다");
        return;
      }

      openAddPrefilled(tabUrl, tab?.title || suggestName(tabUrl));
    });
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

  function normalizeFolderName(value) {
    const folder = String(value || "").trim().replace(/\\/g, "/");
    if (!folder) {
      return DEFAULT_FOLDER_NAME;
    }
    const segments = folder
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part);
    return segments.join("/") || DEFAULT_FOLDER_NAME;
  }

  function generateId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

  function suggestName(url) {
    const domain = extractDomain(url);
    return domain || "";
  }

  function normalizeLinkHealth(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const checkedAt = toSafeNumber(value.checkedAt, 0);
    const status = toSafeNumber(value.status, 0);
    const broken = !!value.broken;

    if (!checkedAt) {
      return null;
    }

    return {
      checkedAt,
      status: status > 0 ? status : 0,
      broken
    };
  }

  function normalizeBookmark(value) {
    const item = value && typeof value === "object" ? value : {};

    const normalizedUrl = normalizeUrl(String(item.url || "").trim());
    const createdAt = toSafeNumber(item.createdAt, Date.now());
    const updatedAt = toSafeNumber(item.updatedAt, createdAt);
    const readerSource = item.reader && typeof item.reader === "object" ? item.reader : null;
    const readerBlocks = Array.isArray(readerSource?.blocks)
      ? readerSource.blocks.map((block) => String(block || "").trim()).filter((block) => block)
      : [];
    const readerImages = Array.isArray(readerSource?.images)
      ? readerSource.images
          .map((src) => normalizeAssetUrl(String(src || ""), normalizedUrl || ""))
          .filter((src) => src)
      : [];
    const normalizedReader = readerSource
      ? {
          title: String(readerSource.title || item.name || normalizedUrl || ""),
          blocks: readerBlocks.slice(0, 80),
          images: readerImages.slice(0, 12),
          extractedAt: toSafeNumber(readerSource.extractedAt, updatedAt)
        }
      : null;

    return {
      id: String(item.id || generateId()),
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
      reader: normalizedReader,
      linkHealth: normalizeLinkHealth(item.linkHealth)
    };
  }

  function normalizeData(raw) {
    let source = raw;

    if (!source || typeof source !== "object") {
      source = {};
    }

    if (Array.isArray(source)) {
      source = {
        version: 1,
        bookmarks: source
      };
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

  function toSafeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function createEmptyData() {
    return normalizeData({
      version: 2,
      updatedAt: Date.now(),
      bookmarks: [],
      tombstones: []
    });
  }

  function cloneStructured(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  async function hydrateDataCache() {
    let loadedFromIndexedDb = null;
    try {
      loadedFromIndexedDb = await readDataRecordFromIndexedDb();
    } catch (_error) {
      loadedFromIndexedDb = null;
    }

    if (loadedFromIndexedDb) {
      dataCache = normalizeData(loadedFromIndexedDb);
      return;
    }

    let loadedFromLegacy = null;
    const legacyRaw = localStorage.getItem(DATA_KEY);
    if (legacyRaw) {
      try {
        loadedFromLegacy = JSON.parse(legacyRaw);
      } catch (_error) {
        loadedFromLegacy = null;
      }
    }

    dataCache = normalizeData(loadedFromLegacy || createEmptyData());
    queuePersistData(dataCache, { clearLegacyLocalStorage: !!loadedFromLegacy });
  }

  function supportsIndexedDb() {
    return typeof indexedDB !== "undefined";
  }

  function openStorageDb() {
    if (storageDbPromise) {
      return storageDbPromise;
    }

    if (!supportsIndexedDb()) {
      return Promise.reject(new Error("IndexedDB를 사용할 수 없는 환경입니다"));
    }

    storageDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(STORAGE_DB_NAME, STORAGE_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORAGE_STORE_NAME)) {
          db.createObjectStore(STORAGE_STORE_NAME);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error || new Error("IndexedDB 초기화에 실패했습니다"));
      };
    });

    return storageDbPromise;
  }

  async function readDataRecordFromIndexedDb() {
    if (!supportsIndexedDb()) {
      return null;
    }

    const db = await openStorageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORAGE_STORE_NAME, "readonly");
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      const request = store.get(STORAGE_DATA_RECORD_KEY);

      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }

        if (typeof result === "string") {
          try {
            resolve(JSON.parse(result));
          } catch (_error) {
            resolve(null);
          }
          return;
        }

        resolve(result);
      };

      request.onerror = () => {
        reject(request.error || new Error("IndexedDB 데이터를 읽지 못했습니다"));
      };
    });
  }

  async function writeDataRecordToIndexedDb(data) {
    if (!supportsIndexedDb()) {
      return false;
    }

    const db = await openStorageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      const request = store.put(data, STORAGE_DATA_RECORD_KEY);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error || new Error("IndexedDB 데이터 저장 실패"));
    });
  }

  function queuePersistData(data, options = {}) {
    const snapshot = cloneStructured(normalizeData(data));
    const clearLegacyLocalStorage = options.clearLegacyLocalStorage === true;

    persistQueue = persistQueue
      .catch(() => {})
      .then(async () => {
        let savedToIndexedDb = false;
        try {
          savedToIndexedDb = await writeDataRecordToIndexedDb(snapshot);
        } catch (_error) {
          savedToIndexedDb = false;
        }

        if (savedToIndexedDb) {
          if (clearLegacyLocalStorage) {
            localStorage.removeItem(DATA_KEY);
          }
          return;
        }

        try {
          localStorage.setItem(DATA_KEY, JSON.stringify(snapshot));
        } catch (_error) {
          const now = Date.now();
          if (now - lastStoragePersistErrorAt > 20000) {
            lastStoragePersistErrorAt = now;
            showToast("저장소 용량이 부족해 일부 데이터 저장에 실패할 수 있습니다");
          }
        }
      });

    return persistQueue;
  }

  function getData() {
    return cloneStructured(dataCache);
  }

  function saveData(data, options = {}) {
    const touch = options.touch !== false;
    const normalized = normalizeData(data);

    if (touch) {
      normalized.updatedAt = Date.now();
    }

    dataCache = normalized;
    queuePersistData(dataCache);
  }

  function getBookmarks() {
    return dataCache.bookmarks;
  }

  function upsertTombstone(data, id, deletedAt) {
    const found = data.tombstones.find((item) => item.id === id);
    if (found) {
      found.deletedAt = Math.max(found.deletedAt, deletedAt);
      return;
    }

    data.tombstones.push({ id, deletedAt });
  }

  function removeTombstone(data, id) {
    const index = data.tombstones.findIndex((item) => item.id === id);
    if (index >= 0) {
      data.tombstones.splice(index, 1);
    }
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
  function getGoogleConfig() {
    const raw = localStorage.getItem(GOOGLE_CONFIG_KEY);
    if (!raw) {
      return {
        clientId: "",
        tokenDuration: GOOGLE_TOKEN_DURATION_DEFAULT
      };
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        clientId: String(parsed.clientId || "").trim(),
        tokenDuration: normalizeGoogleTokenDuration(parsed.tokenDuration)
      };
    } catch (_error) {
      return {
        clientId: "",
        tokenDuration: GOOGLE_TOKEN_DURATION_DEFAULT
      };
    }
  }

  function saveGoogleConfig(config) {
    const clientId = String(config?.clientId || "").trim();
    const tokenDuration = normalizeGoogleTokenDuration(config?.tokenDuration);
    localStorage.setItem(
      GOOGLE_CONFIG_KEY,
      JSON.stringify({
        clientId,
        tokenDuration
      })
    );
    mirrorLocalStorageKeyToExtensionStorage(GOOGLE_CONFIG_KEY);
    requestBackgroundSyncNow();
  }

  function clearGoogleConfig() {
    localStorage.removeItem(GOOGLE_CONFIG_KEY);
    mirrorLocalStorageKeyToExtensionStorage(GOOGLE_CONFIG_KEY);
  }

  function getStoredGoogleToken() {
    const raw = localStorage.getItem(GOOGLE_TOKEN_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      const accessToken = String(parsed.accessToken || "").trim();
      const expiresAt = toSafeNumber(parsed.expiresAt, 0);
      if (!accessToken || expiresAt <= Date.now()) {
        return null;
      }
      return {
        accessToken,
        expiresAt
      };
    } catch (_error) {
      return null;
    }
  }

  function saveGoogleToken(accessToken, expiresInSeconds) {
    const safeExpires = Math.max(120, toSafeNumber(expiresInSeconds, 3600));
    const config = getGoogleConfig();
    const configuredExpiresMs = getGoogleTokenDurationMs(config.tokenDuration);
    const oauthExpiresMs = Math.max(60000, (safeExpires - 60) * 1000);
    const expiresAt = Date.now() + Math.max(configuredExpiresMs, oauthExpiresMs);
    localStorage.setItem(
      GOOGLE_TOKEN_KEY,
      JSON.stringify({
        accessToken,
        expiresAt
      })
    );
    mirrorLocalStorageKeyToExtensionStorage(GOOGLE_TOKEN_KEY);
    requestBackgroundSyncNow();
  }

  function clearGoogleToken() {
    localStorage.removeItem(GOOGLE_TOKEN_KEY);
    mirrorLocalStorageKeyToExtensionStorage(GOOGLE_TOKEN_KEY);
  }

  function normalizeGoogleTokenDuration(value) {
    const normalized = String(value || "").trim();
    if (
      normalized === GOOGLE_TOKEN_DURATION_DAY ||
      normalized === GOOGLE_TOKEN_DURATION_WEEK ||
      normalized === GOOGLE_TOKEN_DURATION_MONTH ||
      normalized === GOOGLE_TOKEN_DURATION_QUARTER ||
      normalized === GOOGLE_TOKEN_DURATION_YEAR
    ) {
      return normalized;
    }
    return GOOGLE_TOKEN_DURATION_DEFAULT;
  }

  function getGoogleTokenDurationMs(tokenDuration) {
    const normalized = normalizeGoogleTokenDuration(tokenDuration);
    return GOOGLE_TOKEN_DURATION_MS[normalized] || GOOGLE_TOKEN_DURATION_MS[GOOGLE_TOKEN_DURATION_DEFAULT];
  }

  async function ensureGoogleToken(options = {}) {
    const interactive = options.interactive !== false;
    const cached = getStoredGoogleToken();
    if (cached) {
      return cached.accessToken;
    }

    const config = getGoogleConfig();
    if (!config.clientId) {
      throw new Error("OAuth 설정에서 Client ID를 먼저 저장해주세요");
    }

    if (!interactive) {
      throw new Error("Google 로그인이 필요합니다. 설정에서 다시 연결해주세요");
    }

    let tokenResponse;
    if (IS_EXTENSION_CONTEXT) {
      tokenResponse = await getTokenForExtension(config.clientId);
    } else {
      tokenResponse = await getTokenForWeb(config.clientId);
    }

    saveGoogleToken(tokenResponse.accessToken, tokenResponse.expiresIn);
    return tokenResponse.accessToken;
  }

  function buildGoogleAuthUrl(clientId, redirectUri, state) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "token");
    url.searchParams.set("scope", DRIVE_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    return url.toString();
  }

  function getTokenForExtension(clientId) {
    return new Promise((resolve, reject) => {
      const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
      const state = generateId();
      const authUrl = buildGoogleAuthUrl(clientId, redirectUri, state);

      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl,
          interactive: true
        },
        (redirectedUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!redirectedUrl) {
            reject(new Error("Google 로그인이 취소되었습니다"));
            return;
          }

          let callback;
          try {
            callback = new URL(redirectedUrl);
          } catch (_error) {
            reject(new Error("OAuth 응답을 해석하지 못했습니다"));
            return;
          }

          const hashParams = new URLSearchParams(callback.hash.replace(/^#/, ""));
          if (hashParams.get("state") !== state) {
            reject(new Error("OAuth state가 일치하지 않습니다"));
            return;
          }

          if (hashParams.get("error")) {
            reject(new Error(`Google 로그인 실패: ${hashParams.get("error")}`));
            return;
          }

          const accessToken = hashParams.get("access_token");
          if (!accessToken) {
            reject(new Error("access_token이 없습니다"));
            return;
          }

          resolve({
            accessToken,
            expiresIn: toSafeNumber(hashParams.get("expires_in"), 3600)
          });
        }
      );
    });
  }

  function getTokenForWeb(clientId) {
    if (window.location.protocol === "file:") {
      throw new Error("웹에서 Drive 연동은 file:// 환경에서 동작하지 않습니다. localhost 또는 HTTPS에서 실행해주세요");
    }

    return new Promise((resolve, reject) => {
      const state = generateId();
      const redirect = new URL(window.location.href);
      redirect.search = "";
      redirect.hash = "";
      redirect.searchParams.set("oauth_callback", "1");

      const authUrl = buildGoogleAuthUrl(clientId, redirect.toString(), state);
      const popup = window.open(authUrl, "rememberGoogleOAuth", "width=540,height=720");

      if (!popup) {
        reject(new Error("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요"));
        return;
      }

      let handled = false;
      const timer = setInterval(() => {
        if (popup.closed && !handled) {
          cleanup();
          reject(new Error("Google 로그인이 취소되었습니다"));
        }
      }, 400);

      function cleanup() {
        clearInterval(timer);
        window.removeEventListener("message", onMessage);
      }

      function onMessage(event) {
        if (event.origin !== window.location.origin) {
          return;
        }

        const payload = event.data || {};
        if (payload.source !== "remember-oauth") {
          return;
        }

        const params = new URLSearchParams(String(payload.hash || "").replace(/^#/, ""));
        if (params.get("state") !== state) {
          return;
        }

        handled = true;
        cleanup();

        if (params.get("error")) {
          reject(new Error(`Google 로그인 실패: ${params.get("error")}`));
          return;
        }

        const accessToken = params.get("access_token");
        if (!accessToken) {
          reject(new Error("access_token이 없습니다"));
          return;
        }

        resolve({
          accessToken,
          expiresIn: toSafeNumber(params.get("expires_in"), 3600)
        });
      }

      window.addEventListener("message", onMessage);
    });
  }

  async function driveFetch(url, options = {}, allowRetry = true, authOptions = {}) {
    const accessToken = await ensureGoogleToken(authOptions);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (response.status === 401 && allowRetry) {
      clearGoogleToken();
      if (authOptions.interactive === false) {
        throw new Error("Google 로그인이 필요합니다. 설정에서 다시 연결해주세요");
      }
      return driveFetch(url, options, false, authOptions);
    }

    if (!response.ok) {
      const text = await response.text();
      const message = text || `HTTP ${response.status}`;
      throw new Error(`Drive API 오류: ${message}`);
    }

    return response;
  }

  async function findDriveFile(authOptions = {}) {
    const query = encodeURIComponent(
      `name='${DRIVE_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=1`;
    const response = await driveFetch(url, { method: "GET" }, true, authOptions);
    const payload = await response.json();
    return payload.files?.[0] || null;
  }

  async function downloadDriveData(fileId, authOptions = {}) {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const response = await driveFetch(url, { method: "GET" }, true, authOptions);
    return normalizeData(await response.json());
  }

  async function uploadDriveData(data, fileId, authOptions = {}) {
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

    const response = await driveFetch(
      endpoint,
      {
        method,
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      },
      true,
      authOptions
    );

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

  async function syncWithDrive(options = {}) {
    const authOptions = {
      interactive: options.interactive !== false
    };
    const safeMode = options.safeMode === true;
    const mode = options.mode === "autoFast" ? "autoFast" : "full";

    if (mode === "autoFast") {
      return syncWithDriveAutoFast(authOptions, safeMode);
    }

    return syncWithDriveFull(authOptions, safeMode);
  }

  async function syncWithDriveAutoFast(authOptions, safeMode) {
    const cache = getDriveSyncCache();
    if (!cache.fileId) {
      return syncWithDriveFull(authOptions, safeMode);
    }

    const local = getData();
    local.updatedAt = Date.now();
    saveData(local, { touch: false });

    try {
      const uploaded = await uploadDriveData(local, cache.fileId, authOptions);
      if (!uploaded?.id) {
        throw new Error("Drive 파일 저장에 실패했습니다");
      }

      saveDriveSyncCache({
        fileId: uploaded.id,
        lastFastSyncAt: Date.now()
      });
      return { skipped: false };
    } catch (error) {
      if (isDriveFileMissingError(error)) {
        clearDriveSyncCache();
        return syncWithDriveFull(authOptions, safeMode);
      }
      throw error;
    }
  }

  async function syncWithDriveFull(authOptions, safeMode) {
    const local = getData();
    const cache = getDriveSyncCache();

    let merged = local;
    let fileId = cache.fileId || "";
    let remoteData = null;

    if (fileId) {
      try {
        remoteData = await downloadDriveData(fileId, authOptions);
      } catch (error) {
        if (isDriveFileMissingError(error)) {
          clearDriveSyncCache();
          fileId = "";
        } else {
          throw error;
        }
      }
    }

    if (!remoteData) {
      const remoteFile = await findDriveFile(authOptions);
      if (remoteFile?.id) {
        fileId = remoteFile.id;
        saveDriveSyncCache({ fileId });
        remoteData = await downloadDriveData(fileId, authOptions);
      }
    }

    if (remoteData) {
      merged = mergeData(local, remoteData);
    }

    if (safeMode && remoteData && shouldSkipAutoSyncForMassDeletion(local, remoteData, merged)) {
      return {
        skipped: true,
        message: "자동 동기화 안전모드: 대량 삭제 가능성이 감지되어 중단했습니다. 설정에서 수동 동기화를 실행해 확인해주세요."
      };
    }

    merged.updatedAt = Date.now();
    saveData(merged, { touch: false });

    const uploaded = await uploadDriveData(merged, fileId || null, authOptions);
    if (!uploaded?.id) {
      throw new Error("Drive 파일 저장에 실패했습니다");
    }

    saveDriveSyncCache({
      fileId: uploaded.id,
      lastFullSyncAt: Date.now(),
      lastFastSyncAt: Date.now()
    });

    return { skipped: false };
  }

  async function uploadLocalToDrive() {
    const local = getData();
    local.updatedAt = Date.now();
    saveData(local, { touch: false });

    const remoteFile = await findDriveFile();
    const uploaded = await uploadDriveData(local, remoteFile?.id || null);

    if (!uploaded?.id) {
      throw new Error("Drive 파일 업로드에 실패했습니다");
    }

    saveDriveSyncCache({
      fileId: uploaded.id,
      lastFastSyncAt: Date.now()
    });
  }

  async function downloadDriveToLocal() {
    const remoteFile = await findDriveFile();
    if (!remoteFile) {
      return false;
    }

    const remoteData = await downloadDriveData(remoteFile.id);
    saveData(remoteData, { touch: false });
    saveDriveSyncCache({
      fileId: remoteFile.id,
      lastFullSyncAt: Date.now(),
      lastFastSyncAt: Date.now()
    });
    return true;
  }
})();

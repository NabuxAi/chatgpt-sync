import { buildMemoryPackage } from "./sync-core.ts";
import { loadSyncIntervalMinutes, SYNC_INTERVAL_KEY } from "./settings.ts";
import { mergeAndSaveOfflineArchive } from "./offline-vault.ts";
import { scanTabWithFallback, checkTabLogin } from "./content-script-bridge.ts";
import { planDeepSyncTargets, planNewChatTargets } from "./deep-sync-planner.ts";
import {
  GENTLE_SYNC_RATE_LIMIT_BACKOFF_MINUTES,
  GENTLE_SYNC_STEP_DELAY_MINUTES,
  packageHitRateLimit
} from "./gentle-sync-policy.ts";
import type {
  Account,
  GentleSyncEvent,
  GentleSyncState,
  LoginState,
  MemoryPackage,
  SyncTarget
} from "./types.ts";

const AUTO_SYNC_ALARM = "chatgpt-sync:auto-sync";
const GENTLE_SYNC_ALARM = "chatgpt-sync:gentle-sync";
const GENTLE_SYNC_STATE_KEY = "chatgpt-sync:gentle-sync-state";
const CHATGPT_URLS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const CHATGPT_HOME_URL = "https://chatgpt.com/";
const PENDING_SCAN_KEY = "chatgpt-sync:pending-scan";
const LAST_SCAN_RESULT_KEY = "chatgpt-sync:last-scan-result";
const PENDING_SCAN_TTL_MS = 10 * 60 * 1000;

interface PendingScan {
  notes: string;
  createdAt: number;
}

interface ScanResult {
  status: string;
  trigger: string;
  account: Account | null;
  package: MemoryPackage;
}

function isChatGptUrl(url = ""): boolean {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
}

async function ensureAutoSyncAlarm(): Promise<void> {
  const periodInMinutes = await loadSyncIntervalMinutes();
  await chrome.alarms.create(AUTO_SYNC_ALARM, {
    periodInMinutes
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId: number | undefined, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    function listener(updatedTabId: number, changeInfo: { status?: string }): void {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;

      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function scanTab(tab: chrome.tabs.Tab): Promise<MemoryPackage | null> {
  if (!tab.id) return null;

  try {
    const scanData = await scanTabWithFallback(chrome, tab.id);

    if (scanData?.error) return null;

    return buildMemoryPackage(scanData, {
      now: new Date().toISOString()
    });
  } catch (_error) {
    return null;
  }
}

async function loadGentleSyncState(): Promise<GentleSyncState | null> {
  const data = await chrome.storage.local.get(GENTLE_SYNC_STATE_KEY);
  return (data[GENTLE_SYNC_STATE_KEY] as GentleSyncState) || null;
}

async function saveGentleSyncState(state: Partial<GentleSyncState>): Promise<void> {
  await chrome.storage.local.set({
    [GENTLE_SYNC_STATE_KEY]: state
  });
}

async function scheduleGentleSyncStep(delayInMinutes = GENTLE_SYNC_STEP_DELAY_MINUTES): Promise<string> {
  const delayWithJitter = delayInMinutes + Math.random() * 0.75;
  await chrome.alarms.create(GENTLE_SYNC_ALARM, {
    delayInMinutes: delayWithJitter
  });
  return new Date(Date.now() + delayWithJitter * 60 * 1000).toISOString();
}

function appendGentleSyncEvent(
  state: { events?: GentleSyncEvent[] },
  label: string,
  detail = ""
): GentleSyncEvent[] {
  return [
    ...(state.events || []),
    {
      label,
      detail,
      at: new Date().toISOString()
    }
  ].slice(-30);
}

async function clearGentleSyncJob(status = "stopped"): Promise<void> {
  const state = await loadGentleSyncState();
  await chrome.alarms.clear(GENTLE_SYNC_ALARM);
  await saveGentleSyncState({
    ...(state || {}),
    status,
    active: false,
    updatedAt: new Date().toISOString()
  });
}

export async function runAutoSync(): Promise<number> {
  const tabs = await chrome.tabs.query({
    url: CHATGPT_URLS
  });

  let synced = 0;

  for (const tab of tabs) {
    const packageData = await scanTab(tab);
    if (!packageData) continue;

    await mergeAndSaveOfflineArchive(packageData, {
      now: new Date().toISOString()
    });
    synced += 1;
  }

  return synced;
}

async function openTargetAndScan(target: SyncTarget): Promise<MemoryPackage | null> {
  const tab = await chrome.tabs.create({
    url: target.url,
    active: false
  });

  try {
    await waitForTabComplete(tab.id);
    await sleep(target.waitMs);
    return await scanTab(tab);
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id);
    }
  }
}

export async function runDeepSyncFromActiveTab() {
  const [activeChatGptTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: CHATGPT_URLS
  });
  const [fallbackChatGptTab] = activeChatGptTab
    ? []
    : await chrome.tabs.query({
        url: CHATGPT_URLS
      });
  const activeTab = activeChatGptTab || fallbackChatGptTab;

  if (!activeTab?.id) {
    throw new Error("Open a ChatGPT tab before running Deep Sync.");
  }

  const activeScanData = await scanTabWithFallback(chrome, activeTab.id);
  const activePackage = buildMemoryPackage(activeScanData, {
    now: new Date().toISOString()
  });
  await mergeAndSaveOfflineArchive(activePackage, {
    now: new Date().toISOString()
  });

  const targets = planDeepSyncTargets(activePackage);
  const seenTargetUrls = new Set(targets.map((target) => target.url));
  let synced = 1;
  let opened = 0;
  let messages = activePackage.messages?.length || 0;
  const targetReports: Array<{ kind: string; url: string; chats: number; messages: number }> = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (target.url === activeTab.url) continue;

    const packageData = await openTargetAndScan(target);
    opened += 1;

    if (!packageData) continue;

    targetReports.push({
      kind: target.kind,
      url: target.url,
      chats: packageData.chats?.length || 0,
      messages: packageData.messages?.length || 0
    });

    await mergeAndSaveOfflineArchive(packageData, {
      now: new Date().toISOString()
    });
    synced += 1;
    messages += packageData.messages?.length || 0;

    if (target.kind === "project") {
      targets.push(...planNewChatTargets(packageData, seenTargetUrls));
    }
  }

  return {
    synced,
    opened,
    targets: targets.length,
    messages,
    targetReports
  };
}

export async function startGentleDeepSyncFromActiveTab(): Promise<GentleSyncState> {
  const [activeChatGptTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: CHATGPT_URLS
  });
  const [fallbackChatGptTab] = activeChatGptTab
    ? []
    : await chrome.tabs.query({
        url: CHATGPT_URLS
      });
  const activeTab = activeChatGptTab || fallbackChatGptTab;

  if (!activeTab?.id) {
    throw new Error("Open a ChatGPT tab before starting Gentle Sync.");
  }

  const activeScanData = await scanTabWithFallback(chrome, activeTab.id);
  const activePackage = buildMemoryPackage(activeScanData, {
    now: new Date().toISOString()
  });

  if (packageHitRateLimit(activePackage)) {
    throw new Error("ChatGPT returned a rate-limit response. Wait before starting sync.");
  }

  await mergeAndSaveOfflineArchive(activePackage, {
    now: new Date().toISOString()
  });

  const targets = planDeepSyncTargets(activePackage).filter(
    (target) => target.url !== activeTab.url
  );

  const state: GentleSyncState = {
    active: true,
    status: targets.length ? "queued" : "complete",
    queue: targets,
    totalTargets: targets.length,
    seenUrls: [activeTab.url, ...targets.map((target) => target.url)].filter(Boolean) as string[],
    synced: 1,
    opened: 0,
    messages: activePackage.messages?.length || 0,
    rateLimitHits: 0,
    currentTarget: null,
    nextRunAt: null,
    lastError: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: []
  };

  if (targets.length) {
    state.nextRunAt = await scheduleGentleSyncStep(GENTLE_SYNC_STEP_DELAY_MINUTES);
    state.events = appendGentleSyncEvent(
      state,
      "Queued",
      `${targets.length} page${targets.length === 1 ? "" : "s"} waiting.`
    );
  } else {
    state.events = appendGentleSyncEvent(state, "Complete", "Current chat was already cached.");
  }

  await saveGentleSyncState(state);

  return state;
}

async function runGentleSyncStep(): Promise<void> {
  const state = await loadGentleSyncState();
  if (!state?.active || !state.queue?.length) {
    await clearGentleSyncJob("complete");
    return;
  }

  const [target, ...restQueue] = state.queue;

  try {
    await saveGentleSyncState({
      ...state,
      status: "syncing",
      currentTarget: target,
      lastError: null,
      updatedAt: new Date().toISOString(),
      events: appendGentleSyncEvent(state, "Opening", target.url)
    });

    const packageData = await openTargetAndScan(target);

    if (packageData && packageHitRateLimit(packageData)) {
      const nextRunAt = await scheduleGentleSyncStep(GENTLE_SYNC_RATE_LIMIT_BACKOFF_MINUTES);
      await saveGentleSyncState({
        ...state,
        status: "backing-off",
        rateLimitHits: (state.rateLimitHits || 0) + 1,
        currentTarget: null,
        nextRunAt,
        lastError: "Rate limit detected. Backing off before retrying.",
        updatedAt: new Date().toISOString(),
        events: appendGentleSyncEvent(
          state,
          "Rate limit",
          "Paused before retrying the same page."
        )
      });
      return;
    }

    let nextQueue = restQueue;
    const seenUrls = new Set(state.seenUrls || []);

    if (packageData) {
      await mergeAndSaveOfflineArchive(packageData, {
        now: new Date().toISOString()
      });

      if (target.kind === "project") {
        nextQueue = [
          ...nextQueue,
          ...planNewChatTargets(packageData, seenUrls)
        ];
      }
    }

    const nextState: GentleSyncState = {
      ...state,
      status: nextQueue.length ? "queued" : "complete",
      active: Boolean(nextQueue.length),
      queue: nextQueue,
      totalTargets: Math.max(state.totalTargets || 0, (state.opened || 0) + 1 + nextQueue.length),
      seenUrls: Array.from(seenUrls),
      opened: (state.opened || 0) + 1,
      synced: (state.synced || 0) + (packageData ? 1 : 0),
      messages: (state.messages || 0) + (packageData?.messages?.length || 0),
      currentTarget: null,
      nextRunAt: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      events: appendGentleSyncEvent(
        state,
        packageData ? "Cached" : "Skipped",
        target.url
      )
    };

    if (nextQueue.length) {
      nextState.nextRunAt = await scheduleGentleSyncStep(GENTLE_SYNC_STEP_DELAY_MINUTES);
    } else {
      await chrome.alarms.clear(GENTLE_SYNC_ALARM);
      nextState.completedAt = new Date().toISOString();
      nextState.events = appendGentleSyncEvent(nextState, "Complete", "Queue finished.");
    }

    await saveGentleSyncState(nextState);
  } catch (error) {
    const nextRunAt = await scheduleGentleSyncStep(GENTLE_SYNC_RATE_LIMIT_BACKOFF_MINUTES);
    await saveGentleSyncState({
      ...state,
      status: "backing-off",
      currentTarget: null,
      nextRunAt,
      lastError: error.message,
      updatedAt: new Date().toISOString(),
      events: appendGentleSyncEvent(state, "Error", error.message)
    });
  }
}

// --- Scan-now orchestration: always target ChatGPT and confirm login -------

let autoScanInFlight = false;

async function findChatGptTab(): Promise<chrome.tabs.Tab | null> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: CHATGPT_URLS
  });

  if (activeTab?.id) return activeTab;

  const [anyTab] = await chrome.tabs.query({
    url: CHATGPT_URLS
  });

  return anyTab || null;
}

async function getTabLoginState(tabId: number): Promise<LoginState> {
  try {
    return await checkTabLogin(chrome, tabId);
  } catch (error) {
    return { loggedIn: null, via: "error", account: null, detail: error.message };
  }
}

async function focusTab(tab: chrome.tabs.Tab | null): Promise<void> {
  if (!tab?.id) return;

  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (_error) {
    // Focusing is best-effort; ignore window/tab races.
  }
}

async function scanAndCacheTab(
  tab: { id?: number; windowId?: number },
  options: { notes?: string } = {}
): Promise<MemoryPackage> {
  if (tab.id == null) {
    throw new Error("No ChatGPT tab to scan.");
  }

  const scanData = await scanTabWithFallback(chrome, tab.id);

  if (scanData?.error) {
    throw new Error(scanData.error);
  }

  const packageData = buildMemoryPackage(scanData, {
    now: new Date().toISOString(),
    notes: options.notes || ""
  });

  await mergeAndSaveOfflineArchive(packageData, {
    now: new Date().toISOString()
  });

  return packageData;
}

async function setPendingScan(notes: string): Promise<void> {
  await chrome.storage.session.set({
    [PENDING_SCAN_KEY]: {
      notes: notes || "",
      createdAt: Date.now()
    }
  });
}

async function loadPendingScan(): Promise<PendingScan | null> {
  const data = await chrome.storage.session.get(PENDING_SCAN_KEY);
  const pending = data[PENDING_SCAN_KEY] as PendingScan | undefined;
  if (!pending) return null;

  if (Date.now() - (pending.createdAt || 0) > PENDING_SCAN_TTL_MS) {
    await clearPendingScan();
    return null;
  }

  return pending;
}

async function clearPendingScan(): Promise<void> {
  await chrome.storage.session.remove(PENDING_SCAN_KEY);
}

async function recordScanResult(result: ScanResult): Promise<void> {
  await chrome.storage.session.set({
    [LAST_SCAN_RESULT_KEY]: {
      ...result,
      at: new Date().toISOString()
    }
  });
}

async function loadScanResult(): Promise<(ScanResult & { at: string }) | null> {
  const data = await chrome.storage.session.get(LAST_SCAN_RESULT_KEY);
  return (data[LAST_SCAN_RESULT_KEY] as ScanResult & { at: string }) || null;
}

async function clearScanResult(): Promise<void> {
  await chrome.storage.session.remove(LAST_SCAN_RESULT_KEY);
}

// Triggered from the popup. Guarantees the scan runs against ChatGPT: it reuses
// an open ChatGPT tab, otherwise opens chatgpt.com, and only scans once the
// signed-in session is confirmed.
async function handleScanNow(options: { notes?: string } = {}) {
  const notes = options.notes || "";
  const existingTab = await findChatGptTab();

  if (existingTab?.id) {
    const login = await getTabLoginState(existingTab.id);

    if (login.loggedIn === false) {
      await setPendingScan(notes);
      await focusTab(existingTab);
      return { ok: true, status: "needs-login", tabId: existingTab.id };
    }

    const packageData = await scanAndCacheTab(existingTab, { notes });
    await recordScanResult({
      status: "scanned",
      trigger: "manual",
      account: login.account || null,
      package: packageData
    });
    await clearPendingScan();

    return {
      ok: true,
      status: "scanned",
      account: login.account || null,
      loginVia: login.via,
      package: packageData
    };
  }

  // No ChatGPT tab anywhere -> open one. The popup closes when the new tab takes
  // focus, so the auto-scan-after-login listener finishes the job and caches the
  // result for the next time the popup opens.
  await setPendingScan(notes);
  const created = await chrome.tabs.create({ url: CHATGPT_HOME_URL, active: true });

  return { ok: true, status: "opening", tabId: created.id || null };
}

// Powers the popup "Scan Page" button. It feels like a quick page scan (sound +
// scanning bar in the popup), but it actually kicks off the thorough Gentle Sync:
// ensure a signed-in ChatGPT tab exists, then start the gentle background job.
async function handleScanAndSync() {
  let tab = await findChatGptTab();

  if (!tab?.id) {
    // Open ChatGPT in the background so the popup stays alive and can show status.
    const created = await chrome.tabs.create({ url: CHATGPT_HOME_URL, active: false });
    await waitForTabComplete(created.id);
    await sleep(1200);
    tab = created.id != null ? await chrome.tabs.get(created.id).catch(() => created) : created;
  }

  if (!tab.id) {
    throw new Error("Open a ChatGPT tab before scanning.");
  }

  const login = await getTabLoginState(tab.id);

  if (login.loggedIn === false) {
    await focusTab(tab);
    return { ok: true, status: "needs-login", tabId: tab.id };
  }

  // Logged in (or login state unknown): start the gentle deep sync from this tab.
  const state = await startGentleDeepSyncFromActiveTab();

  return {
    ok: true,
    status: "started",
    account: login.account || null,
    state
  };
}

// Completes a pending scan as soon as a ChatGPT tab finishes loading while the
// user is signed in (e.g. right after they log in on a freshly opened tab).
async function maybeAutoScanAfterLogin(tabId: number, tab: chrome.tabs.Tab): Promise<void> {
  if (autoScanInFlight) return;
  if (!isChatGptUrl(tab?.url || "")) return;

  const pending = await loadPendingScan();
  if (!pending) return;

  autoScanInFlight = true;

  try {
    const login = await getTabLoginState(tabId);

    // Still signed out: keep the request pending and wait for a later load
    // (the redirect back from the login page fires another "complete").
    if (login.loggedIn === false) return;

    const packageData = await scanAndCacheTab(
      { id: tabId, windowId: tab?.windowId },
      { notes: pending.notes }
    );

    await recordScanResult({
      status: "scanned",
      trigger: "auto-after-login",
      account: login.account || null,
      package: packageData
    });
    await clearPendingScan();
  } catch (_error) {
    // Leave the pending request in place so a later load can retry.
  } finally {
    autoScanInFlight = false;
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!isChatGptUrl(tab?.url || "")) return;

  maybeAutoScanAfterLogin(tabId, tab);
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAutoSyncAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAutoSyncAlarm();
});

// Re-arm the auto-sync alarm immediately when the user changes the interval.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SYNC_INTERVAL_KEY]) {
    ensureAutoSyncAlarm();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SYNC_ALARM) {
    runAutoSync();
    return;
  }

  if (alarm.name === GENTLE_SYNC_ALARM) {
    runGentleSyncStep();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHATGPT_SYNC_START_GENTLE_SYNC") {
    startGentleDeepSyncFromActiveTab()
      .then((state) => {
        sendResponse({ ok: true, state });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CHATGPT_SYNC_STOP_GENTLE_SYNC") {
    clearGentleSyncJob()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CHATGPT_SYNC_GET_GENTLE_SYNC_STATUS") {
    loadGentleSyncState()
      .then((state) => {
        sendResponse({ ok: true, state });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CHATGPT_SYNC_RUN_DEEP_SYNC") {
    startGentleDeepSyncFromActiveTab()
      .then((result) => {
        sendResponse({ ok: true, gentle: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CHATGPT_SYNC_SCAN_NOW") {
    handleScanNow({ notes: message.notes })
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CHATGPT_SYNC_SCAN_AND_SYNC") {
    handleScanAndSync()
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CHATGPT_SYNC_GET_LAST_SCAN_RESULT") {
    loadScanResult()
      .then(async (result) => {
        if (result) await clearScanResult();
        sendResponse({ ok: true, result: result || null });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type !== "CHATGPT_SYNC_RUN_AUTO_SYNC") return;

  runAutoSync()
    .then((synced) => {
      sendResponse({ ok: true, synced });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

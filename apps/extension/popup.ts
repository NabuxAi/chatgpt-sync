import { saveToSession, loadFromSession, clearSession } from "./session-vault.ts";
import { loadSyncIntervalMinutes, saveSyncIntervalMinutes } from "./settings.ts";
import type { MemoryPackage } from "./types.ts";

let currentPackage: MemoryPackage | null = null;

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector) as T;

function setLoading(isLoading: boolean): void {
  $("#captureCard").classList.toggle("is-loading", isLoading);
}

function setStatus(message: string): void {
  $("#status").textContent = message;
}

function updateStats(data: Partial<MemoryPackage> | null | undefined): void {
  const projectCount = data?.projects?.length || (data?.project?.title ? 1 : 0);
  $("#projectCount").textContent = String(projectCount);
  $("#chatCount").textContent = String(data?.chats?.length || 0);
  $("#messageCount").textContent = String(data?.messages?.length || 0);
  $("#fileCount").textContent = String(data?.files?.length || 0);
}

function renderDetectedList(data: Partial<MemoryPackage> | null | undefined): void {
  const list = $("#detectedList");
  list.innerHTML = "";

  const items: Array<{ label: string; value: string }> = [];

  if (data?.projects?.length) {
    for (const project of data.projects) {
      items.push({
        label: project.current ? "Current project" : "Project",
        value: project.title || project.url || "Untitled ChatGPT Project"
      });
    }
  } else if (data?.project?.title) {
    items.push({
      label: "Project",
      value: data.project.title
    });
  }

  for (const chat of data?.chats || []) {
    items.push({
      label: "Chat",
      value: chat.title || chat.url || "Untitled chat"
    });
  }

  for (const message of data?.messages || []) {
    items.push({
      label: message.role || "Message",
      value: message.text?.slice(0, 120) || ""
    });
  }

  for (const file of data?.files || []) {
    items.push({
      label: "File",
      value: file.name || file.id || "ChatGPT file"
    });
  }

  if (!items.length) {
    list.innerHTML = `<div class="list-item">Nothing detected yet.</div>`;
    return;
  }

  for (const item of items.slice(0, 25)) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = `${item.label}: ${item.value}`;
    list.appendChild(div);
  }
}

function downloadJson(data: Partial<MemoryPackage>): void {
  const title = data?.project?.title || "chatgpt-project";
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "chatgpt-project";

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeTitle}.chatgpt-sync.json`;
  link.click();

  URL.revokeObjectURL(url);
}

function applyPackage(data: MemoryPackage | null): void {
  if (!data) return;

  currentPackage = data;
  updateStats(data);
  renderDetectedList(data);
}

// When Scan Page has to open ChatGPT or wait for login, the popup closes before
// the background finishes. On reopen, surface whatever the background captured.
async function loadPendingScanResult(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHATGPT_SYNC_GET_LAST_SCAN_RESULT"
    });

    if (!response?.ok || !response.result?.package) return;

    applyPackage(response.result.package);

    const accountLabel = response.result.account?.label;
    const who = accountLabel ? ` (${accountLabel})` : "";

    setStatus(
      response.result.trigger === "auto-after-login"
        ? `Auto-scan after login complete${who} and cached for offline reading.`
        : `Last ChatGPT scan loaded${who}.`
    );
  } catch (_error) {
    // No cached background result; keep the default status.
  }
}

async function runAutoSyncNow(): Promise<number> {
  const response = await chrome.runtime.sendMessage({
    type: "CHATGPT_SYNC_RUN_AUTO_SYNC"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Auto sync failed.");
  }

  return response.synced || 0;
}

interface ImportSummary {
  projects: number;
  chats: number;
  messages: number;
  files: number;
}

// Merges a loaded backup package into the offline archive so the Offline Reader
// can actually display the restored chats (the real "restore" step).
async function importPackageIntoArchive(packageData: MemoryPackage): Promise<ImportSummary> {
  const response = await chrome.runtime.sendMessage({
    type: "CHATGPT_SYNC_IMPORT_PACKAGE",
    package: packageData
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Could not restore the backup into the offline archive.");
  }

  return response.summary as ImportSummary;
}

// Restores whatever is currently loaded (from a file or browser memory) into the
// offline archive and reports the result in the restore preview.
async function restoreCurrentPackageIntoArchive(): Promise<void> {
  if (!currentPackage) {
    $("#restorePreview").textContent = "Load a backup file or browser memory package first.";
    return;
  }

  try {
    const summary = await importPackageIntoArchive(currentPackage);
    $("#restorePreview").textContent =
      `Restored into the Offline Reader.\n` +
      `Projects: ${summary.projects}\nChats: ${summary.chats}\n` +
      `Messages: ${summary.messages}\nFiles: ${summary.files}\n\n` +
      `Open the Offline Reader to read the restored chats.`;
    setStatus("Backup restored into the Offline Reader.");
  } catch (error) {
    $("#restorePreview").textContent = `Restore failed: ${error.message}`;
  }
}

let scanBarTimer: number | null = null;

// Short synthesized "scan" sweep using the Web Audio API (no bundled asset).
function playScanSound(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;

    const ctx: AudioContext = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(1280, now + 0.28);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.44);
    osc.onended = () => ctx.close().catch(() => {});
  } catch (_error) {
    // Audio is a nice-to-have; ignore autoplay/device failures.
  }
}

function startScanBar(): void {
  const bar = $("#scanBar");
  const fill = $("#scanBarFill");
  if (!bar || !fill) return;

  bar.classList.add("active");
  fill.style.width = "6%";

  let progress = 6;
  window.clearInterval(scanBarTimer ?? undefined);
  scanBarTimer = window.setInterval(() => {
    progress = Math.min(92, progress + Math.random() * 11);
    fill.style.width = `${progress}%`;
  }, 220);
}

function finishScanBar(success: boolean): void {
  window.clearInterval(scanBarTimer ?? undefined);
  const bar = $("#scanBar");
  const fill = $("#scanBarFill");
  if (!bar || !fill) return;

  fill.style.width = success ? "100%" : "0%";
  window.setTimeout(() => bar.classList.remove("active"), success ? 800 : 250);
}

function pluralPages(count: number): string {
  return `${count} page${count === 1 ? "" : "s"}`;
}

// "Scan Page" feels like a quick scan (sound + bar) but actually starts Gentle Sync.
$("#scanPage").addEventListener("click", async () => {
  playScanSound();
  startScanBar();
  setLoading(true);
  setStatus("Scanning page...");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "CHATGPT_SYNC_SCAN_AND_SYNC",
      notes: $<HTMLTextAreaElement>("#projectNotes").value.trim()
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Scan failed.");
    }

    if (result.status === "needs-login") {
      finishScanBar(false);
      setStatus("Switched to your ChatGPT tab. Log in there, then hit Scan Page again.");
      return;
    }

    finishScanBar(true);

    // Surface the captured package so Download JSON Backup / Save to Browser
    // Memory work immediately after a scan.
    if (result.package) {
      applyPackage(result.package);
    }

    const state = result.state || {};
    const queued = state.totalTargets || state.queue?.length || 0;

    if (state.status === "complete" || queued === 0) {
      setStatus("Scan complete. This page is cached and ready to back up or save.");
    } else {
      setStatus(
        `Scan complete and ready to back up. Caching ${pluralPages(queued)} more in the background — open Gentle Sync Progress to watch.`
      );
    }
  } catch (error) {
    finishScanBar(false);
    setStatus(`Scan failed: ${error.message}`);
  } finally {
    setLoading(false);
  }
});

$("#saveSession").addEventListener("click", async () => {
  if (!currentPackage) {
    setStatus("Scan a page first.");
    return;
  }

  await saveToSession(currentPackage);
  setStatus("Saved to browser memory. Now switch to the destination account and load it.");
});

$("#downloadJson").addEventListener("click", () => {
  if (!currentPackage) {
    setStatus("Scan a page first.");
    return;
  }

  downloadJson(currentPackage);
});

$("#syncNow").addEventListener("click", async () => {
  try {
    setLoading(true);
    setStatus("Syncing open ChatGPT tabs...");

    const synced = await runAutoSyncNow();
    setStatus(`Auto sync complete. Cached ${synced} open ChatGPT tab${synced === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(`Auto sync failed: ${error.message}`);
  } finally {
    setLoading(false);
  }
});

$("#deepSync").addEventListener("click", async () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("sync-progress.html?start=1")
  });
});

$("#openOffline").addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("offline.html")
  });
});

$("#openQuickStart").addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("quickstart.html")
  });
});

$("#loadSession").addEventListener("click", async () => {
  const data = await loadFromSession();

  if (!data) {
    $("#restorePreview").textContent = "No browser memory package found.";
    return;
  }

  currentPackage = data;
  updateStats(data);
  renderDetectedList(data);

  $("#restorePreview").textContent = JSON.stringify({
    title: data.project?.title,
    projects: data.projects?.length || (data.project?.title ? 1 : 0),
    chats: data.chats?.length || 0,
    messages: data.messages?.length || 0,
    files: data.files?.length || 0,
    restoreSteps: data.restore?.steps?.map((step) => step.label) || []
  }, null, 2);

  await restoreCurrentPackageIntoArchive();
});

$("#restoreIntoReader").addEventListener("click", restoreCurrentPackageIntoArchive);

$("#clearSession").addEventListener("click", async () => {
  await clearSession();
  $("#restorePreview").textContent = "Browser memory cleared.";
  setStatus("Session package cleared.");
});

$("#restoreFile").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    currentPackage = data;
    updateStats(data);
    renderDetectedList(data);

    $("#restorePreview").textContent = JSON.stringify({
      title: data.project?.title,
      projects: data.projects?.length || (data.project?.title ? 1 : 0),
      chats: data.chats?.length || 0,
      messages: data.messages?.length || 0,
      files: data.files?.length || 0,
      restoreSteps: data.restore?.steps?.map((step: { label: string }) => step.label) || []
    }, null, 2);

    await restoreCurrentPackageIntoArchive();
  } catch (error) {
    $("#restorePreview").textContent = `Invalid backup file: ${error.message}`;
  }
});

async function initSyncInterval(): Promise<void> {
  $<HTMLInputElement>("#syncInterval").value = String(await loadSyncIntervalMinutes());
}

$("#saveSyncInterval").addEventListener("click", async () => {
  const input = $<HTMLInputElement>("#syncInterval");
  const saved = await saveSyncIntervalMinutes(input.value);
  input.value = String(saved);
  $("#settingsStatus").textContent = `Auto-sync set to every ${saved} minute${saved === 1 ? "" : "s"}.`;
});

initSyncInterval();
loadPendingScanResult();

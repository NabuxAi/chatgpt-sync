import { saveToSession, loadFromSession, clearSession } from "./session-vault.js";
import { mergeAndSaveOfflineArchive } from "./offline-vault.js";
import { buildMemoryPackage } from "./sync-core.js";
import { scanTabWithFallback } from "./content-script-bridge.js";

let currentPackage = null;

const $ = (selector) => document.querySelector(selector);

function setLoading(isLoading) {
  $("#captureCard").classList.toggle("is-loading", isLoading);
}

function setStatus(message) {
  $("#status").textContent = message;
}

function updateStats(data) {
  const projectCount = data?.projects?.length || (data?.project?.title ? 1 : 0);
  $("#projectCount").textContent = String(projectCount);
  $("#chatCount").textContent = String(data?.chats?.length || 0);
  $("#messageCount").textContent = String(data?.messages?.length || 0);
  $("#fileCount").textContent = String(data?.files?.length || 0);
}

function renderDetectedList(data) {
  const list = $("#detectedList");
  list.innerHTML = "";

  const items = [];

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

function downloadJson(data) {
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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function scanCurrentPage() {
  const tab = await getActiveTab();

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return scanTabWithFallback(chrome, tab.id);
}

async function runAutoSyncNow() {
  const response = await chrome.runtime.sendMessage({
    type: "CHATGPT_SYNC_RUN_AUTO_SYNC"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Auto sync failed.");
  }

  return response.synced || 0;
}

$("#scanPage").addEventListener("click", async () => {
  try {
    setLoading(true);
    setStatus("Scanning ChatGPT page and same-session conversation API...");

    const scanData = await scanCurrentPage();
    currentPackage = buildMemoryPackage(scanData, {
      notes: $("#projectNotes").value.trim()
    });
    await mergeAndSaveOfflineArchive(currentPackage);

    updateStats(currentPackage);
    renderDetectedList(currentPackage);

    setStatus(
      currentPackage.capture?.method === "chatgpt-backend-api"
        ? "API capture complete and cached for offline reading."
        : "Visible page scan complete and cached for offline reading."
    );
  } catch (error) {
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
});

$("#clearSession").addEventListener("click", async () => {
  await clearSession();
  $("#restorePreview").textContent = "Browser memory cleared.";
  setStatus("Session package cleared.");
});

$("#restoreFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
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
      restoreSteps: data.restore?.steps?.map((step) => step.label) || []
    }, null, 2);
  } catch (error) {
    $("#restorePreview").textContent = `Invalid backup file: ${error.message}`;
  }
});

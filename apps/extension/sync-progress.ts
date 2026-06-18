import type { GentleSyncEvent, GentleSyncState } from "./types.ts";

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector) as T;
const params = new URLSearchParams(window.location.search);

let pollTimer: number | null = null;
let startedFromUrl = false;

function formatDate(value: string | null | undefined): string {
  if (!value) return "";

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch (_error) {
    return String(value);
  }
}

function formatShortTime(value: string | null | undefined): string {
  if (!value) return "";

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeStyle: "medium"
    }).format(new Date(value));
  } catch (_error) {
    return String(value);
  }
}

async function sendMessage(type: string): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) {
    throw new Error(response?.error || "Request failed.");
  }
  return response;
}

async function startSync(): Promise<void> {
  setBusy(true);
  try {
    const response = await sendMessage("CHATGPT_SYNC_START_GENTLE_SYNC");
    renderState(response.state);
  } catch (error) {
    renderError(error.message);
  } finally {
    setBusy(false);
  }
}

async function stopSync(): Promise<void> {
  setBusy(true);
  try {
    await sendMessage("CHATGPT_SYNC_STOP_GENTLE_SYNC");
    await refreshStatus();
  } catch (error) {
    renderError(error.message);
  } finally {
    setBusy(false);
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const response = await sendMessage("CHATGPT_SYNC_GET_GENTLE_SYNC_STATUS");
    renderState(response.state);
  } catch (error) {
    renderError(error.message);
  }
}

function setBusy(isBusy: boolean): void {
  $<HTMLButtonElement>("#startSync").disabled = isBusy;
  $<HTMLButtonElement>("#stopSync").disabled = isBusy;
  $<HTMLButtonElement>("#refreshStatus").disabled = isBusy;
}

function progressForState(state: GentleSyncState | null): number {
  if (!state) return 0;
  if (state.status === "complete") return 100;

  const remaining = state.queue?.length || 0;
  const current = state.currentTarget ? 1 : 0;
  const done = state.synced || 0;
  const total = Math.max(state.totalTargets + 1 || 0, done + remaining + current, 1);

  return Math.min(99, Math.round((done / total) * 100));
}

function setPill(status = "idle"): void {
  const pill = $("#statusPill");
  pill.className = `status-pill ${status}`;
  pill.textContent = status
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderState(state: GentleSyncState | null): void {
  if (!state) {
    setPill("idle");
    $("#jobTitle").textContent = "Ready to start";
    $("#progressPercent").textContent = "0%";
    $("#progressFill").style.width = "0%";
    $("#queuedCount").textContent = "0";
    $("#openedCount").textContent = "0";
    $("#cachedCount").textContent = "0";
    $("#rateLimitCount").textContent = "0";
    $("#nextRun").textContent = "Open a ChatGPT tab, then start Gentle Sync.";
    $("#currentTarget").textContent = "";
    $("#updatedAt").textContent = "Waiting";
    $("#eventLog").innerHTML = `<li><strong>No job yet</strong><p>Start a Gentle Sync job to see live progress here.</p></li>`;
    return;
  }

  const progress = progressForState(state);

  setPill(state.status || "idle");
  $("#jobTitle").textContent = titleForState(state);
  $("#progressPercent").textContent = `${progress}%`;
  $("#progressFill").style.width = `${progress}%`;
  $("#queuedCount").textContent = String(state.queue?.length || 0);
  $("#openedCount").textContent = String(state.opened || 0);
  $("#cachedCount").textContent = String(state.synced || 0);
  $("#rateLimitCount").textContent = String(state.rateLimitHits || 0);
  $("#nextRun").textContent = nextRunText(state);
  $("#currentTarget").textContent = state.currentTarget?.url
    ? `Current page: ${state.currentTarget.url}`
    : state.lastError
      ? `Last note: ${state.lastError}`
      : "";
  $("#updatedAt").textContent = state.updatedAt ? `Updated ${formatShortTime(state.updatedAt)}` : "Waiting";
  renderEvents(state.events || []);
}

function titleForState(state: GentleSyncState): string {
  if (state.status === "complete") return "Sync complete";
  if (state.status === "syncing") return "Opening and caching the next page";
  if (state.status === "backing-off") return "Paused to protect the account";
  if (state.status === "queued") return "Queued and waiting for the next safe step";
  if (state.status === "stopped") return "Sync stopped";
  return "Gentle Sync status";
}

function nextRunText(state: GentleSyncState): string {
  if (state.status === "complete") return `Finished ${formatDate(state.completedAt || state.updatedAt)}.`;
  if (state.nextRunAt) return `Next background step around ${formatDate(state.nextRunAt)}.`;
  if (state.status === "syncing") return "A page is being opened and scanned now.";
  if (state.status === "stopped") return "The job is stopped. Start again when you are ready.";
  return "Waiting for the next background alarm.";
}

function renderEvents(events: GentleSyncEvent[]): void {
  if (!events.length) {
    $("#eventLog").innerHTML = `<li><strong>Queued</strong><p>The first activity will appear after the job starts.</p></li>`;
    return;
  }

  $("#eventLog").innerHTML = events
    .slice()
    .reverse()
    .map(
      (event) => `
        <li>
          <strong>${escapeHtml(event.label || "Event")}</strong>
          ${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ""}
          <span class="event-time">${escapeHtml(formatDate(event.at))}</span>
        </li>
      `
    )
    .join("");
}

function renderError(message: string): void {
  setPill("idle");
  $("#jobTitle").textContent = "Could not update sync";
  $("#currentTarget").textContent = message;
  $("#eventLog").innerHTML = `
    <li>
      <strong>Error</strong>
      <p>${escapeHtml(message)}</p>
      <span class="event-time">${escapeHtml(formatDate(new Date().toISOString()))}</span>
    </li>
  `;
}

function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

$("#startSync").addEventListener("click", () => {
  startSync();
});

$("#stopSync").addEventListener("click", () => {
  stopSync();
});

$("#refreshStatus").addEventListener("click", () => {
  refreshStatus();
});

$("#openOffline").addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("offline.html")
  });
});

if (params.get("start") === "1" && !startedFromUrl) {
  startedFromUrl = true;
  startSync();
} else {
  refreshStatus();
}

pollTimer = window.setInterval(refreshStatus, 5000);
window.addEventListener("beforeunload", () => {
  if (pollTimer) window.clearInterval(pollTimer);
});

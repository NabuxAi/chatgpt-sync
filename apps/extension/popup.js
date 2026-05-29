const snapshotKey = "chatgpt-sync:last-snapshot";

const $ = (selector) => document.querySelector(selector);

function buildSnapshot() {
  const now = new Date().toISOString();
  const title = $("#projectTitle").value.trim() || "Untitled ChatGPT Project";
  const instructions = $("#projectInstructions").value.trim();
  const notes = $("#projectNotes").value.trim();

  return {
    schemaVersion: "0.1",
    app: "chatgpt-sync",
    createdAt: now,
    source: {
      platform: "chatgpt-web",
      url: null,
      accountHint: ""
    },
    project: {
      title,
      instructions,
      notes,
      color: null,
      icon: null
    },
    chats: [],
    files: [],
    restore: {
      steps: [
        { id: "create-project", label: "Create a new ChatGPT Project", done: false },
        { id: "copy-instructions", label: "Copy project instructions", done: false },
        { id: "upload-files", label: "Re-upload files", done: false },
        { id: "attach-chat-archive", label: "Add chat archive as project reference", done: false }
      ]
    }
  };
}

function downloadJson(data) {
  const safeTitle = data.project.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "chatgpt-project";

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeTitle}.chatgpt-sync.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveSnapshot(snapshot) {
  await chrome.storage.local.set({ [snapshotKey]: snapshot });
}

async function getLastSnapshot() {
  const result = await chrome.storage.local.get(snapshotKey);
  return result[snapshotKey];
}

$("#createSnapshot").addEventListener("click", async () => {
  const snapshot = buildSnapshot();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  snapshot.source.url = tab?.url || null;

  await saveSnapshot(snapshot);
  downloadJson(snapshot);
});

$("#downloadLast").addEventListener("click", async () => {
  const snapshot = await getLastSnapshot();
  if (!snapshot) {
    alert("No snapshot found yet.");
    return;
  }
  downloadJson(snapshot);
});

$("#restoreFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const preview = {
      title: data?.project?.title,
      instructionsLength: data?.project?.instructions?.length || 0,
      chats: data?.chats?.length || 0,
      files: data?.files?.length || 0,
      steps: data?.restore?.steps?.map((step) => step.label) || []
    };
    $("#restorePreview").textContent = JSON.stringify(preview, null, 2);
  } catch (error) {
    $("#restorePreview").textContent = `Invalid backup file: ${error.message}`;
  }
});

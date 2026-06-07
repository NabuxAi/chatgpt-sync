import { loadOfflineArchive, clearOfflineArchive } from "./offline-vault.js";
import { summarizeArchive } from "./sync-core.js";

const $ = (selector) => document.querySelector(selector);

let archive = null;
let selectedAccountKey = "";
let selectedChatKey = "";
let expandedProjectKey = "";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
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

function accountFallbackKey(item = {}) {
  return item.accountKey || "default";
}

function getAccounts(nextArchive) {
  const accounts = new Map();

  for (const account of nextArchive?.accounts || []) {
    if (!account?.key) continue;
    accounts.set(account.key, {
      key: account.key,
      label: account.label || "ChatGPT account"
    });
  }

  for (const item of [
    ...(nextArchive?.projects || []),
    ...(nextArchive?.chats || []),
    ...(nextArchive?.messages || []),
    ...(nextArchive?.files || [])
  ]) {
    const key = accountFallbackKey(item);
    if (accounts.has(key)) continue;

    accounts.set(key, {
      key,
      label: item.accountLabel || "Saved account"
    });
  }

  if (!accounts.size) {
    accounts.set("default", {
      key: "default",
      label: "Saved account"
    });
  }

  return Array.from(accounts.values());
}

function chatKey(chat = {}) {
  return chat.key || `${accountFallbackKey(chat)}:${chat.url || chat.title || "current"}`;
}

function projectTitle(projectKey) {
  return (
    (archive?.projects || []).find((project) => project.key === projectKey)?.title ||
    "ChatGPT"
  );
}

function accountProjects() {
  return accountItems(archive?.projects || []);
}

function accountItems(items = []) {
  return items.filter((item) => accountFallbackKey(item) === selectedAccountKey);
}

function getVisibleProjectsWithChats() {
  const query = $("#chatSearch").value.trim().toLowerCase();
  const chats = accountItems(archive?.chats || []);
  const projects = accountProjects();
  const groups = new Map();

  for (const project of projects) {
    groups.set(project.key, {
      project,
      chats: []
    });
  }

  for (const chat of chats) {
    const key = chat.projectKey || "ungrouped";
    if (!groups.has(key)) {
      groups.set(key, {
        project: {
          key,
          title: key === "ungrouped" ? "Chats" : projectTitle(key)
        },
        chats: []
      });
    }
    groups.get(key).chats.push(chat);
  }

  const allGroups = Array.from(groups.values());
  if (!query) return allGroups;

  return allGroups
    .map((group) => {
      const projectMatches = `${group.project.title || ""}`.toLowerCase().includes(query);
      const matchingChats = group.chats.filter((chat) =>
        `${chat.title || ""} ${group.project.title || ""}`.toLowerCase().includes(query)
      );

      return {
        ...group,
        chats: projectMatches ? group.chats : matchingChats
      };
    })
    .filter((group) => {
      const projectMatches = `${group.project.title || ""}`.toLowerCase().includes(query);
      return projectMatches || group.chats.length;
    });
}

function flattenGroups(groups) {
  return groups.flatMap((group) => group.chats);
}

function selectedChatFromGroups(groups) {
  return flattenGroups(groups).find((chat) => chatKey(chat) === selectedChatKey);
}

function ensureExpandedProject(groups, selectedChat) {
  if (groups.some((group) => group.project.key === expandedProjectKey)) {
    return;
  }

  expandedProjectKey = selectedChat?.projectKey || groups[0]?.project.key || "";
}

function projectChatCountLabel(count) {
  return `${count} chat${count === 1 ? "" : "s"}`;
}

function renderProjectGroup(group) {
  const isExpanded = group.project.key === expandedProjectKey;
  const chatsHtml = isExpanded
    ? `<div class="chat-nest">
        ${
          group.chats.length
            ? group.chats
                .map((chat) => {
                  const key = chatKey(chat);
                  return `
                    <button class="chat-row ${key === selectedChatKey ? "active" : ""}" data-chat-key="${escapeHtml(key)}">
                      <span class="chat-title" dir="auto">${escapeHtml(chat.title || "Untitled chat")}</span>
                      <span class="chat-project">${escapeHtml(formatDate(chat.updatedAt) || "Cached chat")}</span>
                    </button>
                  `;
                })
                .join("")
            : `<p class="no-chats">No cached chats inside this project yet.</p>`
        }
      </div>`
    : "";

  return `
    <section class="project-group">
      <button class="project-row ${isExpanded ? "expanded" : ""}" data-project-key="${escapeHtml(group.project.key)}">
        <span class="project-caret">${isExpanded ? "⌄" : "›"}</span>
        <span>
          <span class="project-name" dir="auto">${escapeHtml(group.project.title || "Untitled project")}</span>
          <span class="project-count">${escapeHtml(projectChatCountLabel(group.chats.length))}</span>
        </span>
      </button>
      ${chatsHtml}
    </section>
  `;
}

function wireProjectList(list, groups) {
  for (const row of list.querySelectorAll(".project-row")) {
    row.addEventListener("click", () => {
      expandedProjectKey =
        expandedProjectKey === row.dataset.projectKey ? "" : row.dataset.projectKey;
      renderChatList();
    });
  }

  for (const row of list.querySelectorAll(".chat-row")) {
    row.addEventListener("click", () => {
      selectedChatKey = row.dataset.chatKey;
      const chat = selectedChatFromGroups(groups);
      if (chat?.projectKey) expandedProjectKey = chat.projectKey;
      renderChatList();
      renderConversation(chat);
    });
  }
}

function getVisibleChats() {
  return flattenGroups(getVisibleProjectsWithChats());
}

function getMessagesForChat(chat) {
  const key = chatKey(chat);
  return accountItems(archive?.messages || []).filter(
    (message) => message.chatKey === key || message.chatUrl === chat.url
  );
}

function getFilesForChat(chat) {
  const key = chatKey(chat);
  return accountItems(archive?.files || []).filter(
    (file) => file.chatKey === key || file.chatUrl === chat.url
  );
}

function sourceFileUrl(file = {}) {
  if (file.dataUrl) return "";
  if (file.sourceDownloadPath?.startsWith("http")) return file.sourceDownloadPath;
  if (file.sourceDownloadPath?.startsWith("/")) {
    return `https://chatgpt.com${file.sourceDownloadPath}`;
  }
  return "";
}

function renderAccounts() {
  const accounts = getAccounts(archive);
  if (!accounts.some((account) => account.key === selectedAccountKey)) {
    selectedAccountKey = accounts[0]?.key || "default";
  }

  $("#accountSelect").innerHTML = accounts
    .map(
      (account) =>
        `<option value="${escapeHtml(account.key)}"${account.key === selectedAccountKey ? " selected" : ""}>${escapeHtml(account.label)}</option>`
    )
    .join("");
}

function renderSummary() {
  const summary = summarizeArchive({
    ...archive,
    projects: accountItems(archive?.projects || []),
    chats: accountItems(archive?.chats || []),
    messages: accountItems(archive?.messages || [])
  });

  $("#offlineProjectCount").textContent = String(summary.projects);
  $("#offlineChatCount").textContent = String(summary.chats);
  $("#offlineMessageCount").textContent = String(summary.messages);
  $("#lastSyncedAt").textContent = archive?.lastSyncedAt
    ? `Last synced ${formatDate(archive.lastSyncedAt)}`
    : "Not synced yet.";
}

function renderChatList() {
  const groups = getVisibleProjectsWithChats();
  const chats = flattenGroups(groups);
  const list = $("#chatList");

  if (!groups.length) {
    list.innerHTML = `<p class="empty-state">No cached projects or chats for this account yet.</p>`;
    selectedChatKey = "";
    expandedProjectKey = "";
    renderConversation(null);
    return;
  }

  if (chats.length && !chats.some((chat) => chatKey(chat) === selectedChatKey)) {
    selectedChatKey = chatKey(chats[0]);
  }

  const selectedChat = selectedChatFromGroups(groups);
  ensureExpandedProject(groups, selectedChat);

  list.innerHTML = groups.map(renderProjectGroup).join("");
  wireProjectList(list, groups);

  renderConversation(selectedChatFromGroups(groups) || null);
}

function renderFiles(chat) {
  const files = chat ? getFilesForChat(chat) : [];
  const strip = $("#fileStrip");

  strip.classList.toggle("visible", Boolean(files.length));

  if (!files.length) {
    strip.innerHTML = "";
    return;
  }

  strip.innerHTML = files
    .map((file) => {
      const isImage = String(file.mimeType || "").startsWith("image/");
      const thumb = file.dataUrl && isImage
        ? `<span class="image-fallback-label">IMG</span><img src="${escapeHtml(file.dataUrl)}" alt="${escapeHtml(file.name || "Cached image")}" />`
        : escapeHtml(isImage ? "IMG" : "FILE");
      const url = sourceFileUrl(file);
      const action = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source file</a>`
        : `<span class="file-meta">Preview cached locally</span>`;

      return `
        <article class="file-card">
          <div class="file-thumb">${thumb}</div>
          <div>
            <p class="file-name">${escapeHtml(file.name || file.id || "Attachment")}</p>
            <p class="file-meta">${escapeHtml(file.mimeType || "attachment")}</p>
            ${action}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMessages(chat) {
  const messages = chat ? getMessagesForChat(chat) : [];

  if (!chat) {
    $("#messageList").innerHTML = `<section class="empty-state">Choose an offline chat from the left sidebar.</section>`;
    return;
  }

  if (!messages.length) {
    $("#messageList").innerHTML = `
      ${renderInlineFiles(chat)}
      <section class="empty-state">This chat is saved, but no messages are cached yet.</section>
    `;
    return;
  }

  $("#messageList").innerHTML = `
    ${renderInlineFiles(chat)}
    ${messages
      .map((message) => {
        const role = message.role || "message";
        return `
          <article class="message ${escapeHtml(role)}">
            <div class="message-content">
              ${role === "assistant" || role === "message" ? `<div class="message-role">${escapeHtml(role)}</div>` : ""}
              <div class="bubble" dir="auto">${escapeHtml(message.text)}</div>
            </div>
          </article>
        `;
      })
      .join("")}
  `;
}

function renderInlineFiles(chat) {
  const files = getFilesForChat(chat);
  if (!files.length) return "";

  return `
    <section class="inline-files">
      <p class="inline-files-title">Attachments</p>
      <div class="inline-file-grid">
        ${files.map(renderInlineFile).join("")}
      </div>
    </section>
  `;
}

function renderInlineFile(file) {
  const isImage = String(file.mimeType || "").startsWith("image/");
  const preview = file.dataUrl && isImage
    ? `<span class="image-fallback-label">Image preview unavailable offline</span><img src="${escapeHtml(file.dataUrl)}" alt="${escapeHtml(file.name || "Cached image")}" />`
    : `<div class="inline-file-placeholder">
        <strong>${isImage ? "IMG" : "FILE"}</strong>
        <span>${isImage ? "Image preview unavailable offline" : "File preview unavailable offline"}</span>
      </div>`;
  const url = sourceFileUrl(file);

  return `
    <article class="inline-file">
      <div class="inline-file-preview">${preview}</div>
      <div class="inline-file-caption">
        <p class="file-name" dir="auto">${escapeHtml(file.name || file.id || "Attachment")}</p>
        <p class="file-meta">${escapeHtml(file.mimeType || "attachment")}</p>
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source file</a>` : ""}
      </div>
    </article>
  `;
}

function renderConversation(chat) {
  $("#conversationTitle").textContent = chat?.title || "Cached ChatGPT conversation";
  $("#conversationMeta").textContent = chat
    ? `${projectTitle(chat.projectKey)} · ${formatDate(chat.updatedAt)}`
    : "Select a chat";

  const sourceLink = $("#sourceLink");
  sourceLink.classList.toggle("visible", Boolean(chat?.url));
  sourceLink.href = chat?.url || "#";

  renderFiles(chat);
  renderMessages(chat);
}

async function renderOfflineArchive() {
  archive = await loadOfflineArchive();

  renderAccounts();
  renderSummary();
  renderChatList();
}

$("#refreshArchive").addEventListener("click", () => {
  renderOfflineArchive();
});

$("#clearArchive").addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Clear all cached chats from this browser? This removes the offline archive so you can re-scan from scratch. It does not touch your ChatGPT account."
  );
  if (!confirmed) return;

  await clearOfflineArchive();
  selectedAccountKey = "";
  selectedChatKey = "";
  expandedProjectKey = "";
  await renderOfflineArchive();
});

$("#accountSelect").addEventListener("change", (event) => {
  selectedAccountKey = event.target.value;
  selectedChatKey = "";
  expandedProjectKey = "";
  renderSummary();
  renderChatList();
});

$("#chatSearch").addEventListener("input", () => {
  selectedChatKey = "";
  expandedProjectKey = "";
  renderChatList();
});

renderOfflineArchive();

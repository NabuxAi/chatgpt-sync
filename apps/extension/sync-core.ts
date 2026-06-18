import type {
  Account,
  AccountRecord,
  ArchiveSummary,
  BuildOptions,
  ChatRecord,
  FileRecord,
  MemoryPackage,
  MessageRecord,
  OfflineArchive,
  ProjectRecord,
  ProjectScan,
  RestoreStep,
  ScanData
} from "./types.ts";

export const AUTO_SYNC_PERIOD_MINUTES = 10;

const RESTORE_STEPS: RestoreStep[] = [
  {
    id: "create-project",
    label: "Create a new ChatGPT Project in the destination account",
    done: false
  },
  {
    id: "copy-instructions",
    label: "Copy project instructions and notes",
    done: false
  },
  {
    id: "paste-archive",
    label: "Paste or upload the captured chat archive",
    done: false
  },
  {
    id: "reupload-files",
    label: "Re-upload project files manually",
    done: false
  }
];

function cleanText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackNow(): string {
  return new Date().toISOString();
}

function cloneRestoreSteps(): RestoreStep[] {
  return RESTORE_STEPS.map((step) => ({ ...step }));
}

export function buildMemoryPackage(scanData: ScanData = {}, options: BuildOptions = {}): MemoryPackage {
  const now = options.now || fallbackNow();
  const project = scanData.project || {};
  const projectTitle = cleanText(project.title) || "Untitled ChatGPT Project";
  const visibleProjects = Array.isArray(scanData.projects) ? scanData.projects : [];
  const projects = dedupeProjects([
    {
      title: projectTitle,
      url: scanData.url || null,
      instructions: project.instructions || "",
      current: true
    },
    ...visibleProjects
  ]);

  return {
    schemaVersion: "0.2",
    app: "chatgpt-sync",
    mode: "memory-bridge",
    createdAt: now,
    source: {
      platform: "chatgpt-web",
      url: scanData.url || null,
      account: normalizeAccount(scanData.account, scanData.url)
    },
    project: {
      title: projectTitle,
      instructions: project.instructions || "",
      notes: cleanText(options.notes),
      detectedFromPage: true
    },
    projects,
    chats: Array.isArray(scanData.chats) ? scanData.chats : [],
    messages: Array.isArray(scanData.messages) ? scanData.messages : [],
    files: Array.isArray(scanData.files) ? scanData.files : [],
    capture: {
      method: scanData.captureMethod || "visible-dom",
      backendConversationId: scanData.backendConversationId || null,
      backendProjectId: scanData.backendProjectId || null,
      backendApiError: scanData.backendApiError || null
    },
    restore: {
      steps: cloneRestoreSteps()
    }
  };
}

function dedupeProjects(projects: ProjectScan[]): ProjectScan[] {
  const unique = new Map<string, ProjectScan>();
  const titleKeys = new Map<string, string>();

  for (const project of projects) {
    const title = cleanText(project.title);
    const url = project.url || null;
    const titleKey = title.toLowerCase();
    const key = titleKeys.get(titleKey) || url || title;

    if (!title) continue;

    if (unique.has(key)) {
      const existing = unique.get(key)!;
      if (url?.includes("/g/") || url?.includes("/project")) {
        existing.url = url;
      }
      existing.current = existing.current || Boolean(project.current);
      if (!existing.instructions && project.instructions) {
        existing.instructions = project.instructions;
      }
      continue;
    }

    titleKeys.set(titleKey, key);
    unique.set(key, {
      title,
      url,
      instructions: project.instructions || "",
      current: Boolean(project.current)
    });

    if (url?.includes("/g/") || url?.includes("/project")) {
      unique.get(key)!.url = url;
    }
  }

  return Array.from(unique.values());
}

export function createEmptyOfflineArchive(now: string | null = null): OfflineArchive {
  return {
    schemaVersion: "0.2",
    app: "chatgpt-sync",
    mode: "offline-archive",
    createdAt: now || fallbackNow(),
    lastSyncedAt: null,
    projects: [],
    accounts: [],
    chats: [],
    messages: [],
    files: []
  };
}

function upsertByKey<T extends Record<string, any>>(items: T[], nextItem: T, key: keyof T): T[] {
  const index = items.findIndex((item) => item[key] === nextItem[key]);
  if (index === -1) {
    return [...items, nextItem];
  }

  const updated = [...items];
  updated[index] = {
    ...updated[index],
    ...nextItem
  };
  return updated;
}

interface MessageKeyParts {
  chatKey?: string;
  chatUrl?: string | null;
  role?: string;
  text?: string;
}

function messageKey(message: MessageKeyParts): string {
  return `${message.chatKey || message.chatUrl || ""}:${message.role || "message"}:${cleanText(message.text).slice(0, 160)}`;
}

function fileKey(file: FileRecord | { id?: string; sourceDownloadPath?: string; name?: string }): string {
  return file.id || file.sourceDownloadPath || file.name || "";
}

function normalizeAccount(account: Partial<Account> = {}, sourceUrl: string | null = ""): Account {
  const label = cleanText(account.label || account.name) || "ChatGPT account";
  const host = (() => {
    try {
      return sourceUrl ? new URL(sourceUrl).hostname : "chatgpt.com";
    } catch (_error) {
      return "chatgpt.com";
    }
  })();
  const key = cleanText(account.key || label || host).toLowerCase();

  return {
    key: key || host,
    label
  };
}

export function mergePackageIntoArchive(
  existingArchive: OfflineArchive | null | undefined,
  packageData: MemoryPackage,
  options: BuildOptions = {}
): OfflineArchive {
  const now = options.now || fallbackNow();
  const archive = existingArchive || createEmptyOfflineArchive(now);
  const sourceUrl = packageData?.source?.url || null;
  const account = normalizeAccount(packageData?.source?.account, sourceUrl);
  const accountKey = account.key;
  const projectTitle = packageData?.project?.title || "Untitled ChatGPT Project";
  const packageProjects: ProjectScan[] =
    Array.isArray(packageData?.projects) && packageData.projects.length
      ? packageData.projects
      : [
          {
            title: projectTitle,
            url: sourceUrl,
            instructions: packageData?.project?.instructions || "",
            current: true
          }
        ];
  const currentPackageProject =
    packageProjects.find((project) => project.current) || packageProjects[0];
  const projectKey =
    currentPackageProject?.url ||
    currentPackageProject?.title ||
    sourceUrl ||
    projectTitle;

  let projects: ProjectRecord[] = Array.isArray(archive.projects) ? archive.projects : [];
  let accounts: AccountRecord[] = Array.isArray(archive.accounts) ? archive.accounts : [];
  let chats: ChatRecord[] = Array.isArray(archive.chats) ? archive.chats : [];
  let messages: MessageRecord[] = Array.isArray(archive.messages) ? archive.messages : [];
  let files: FileRecord[] = Array.isArray(archive.files) ? archive.files : [];

  accounts = upsertByKey(
    accounts,
    {
      ...account,
      updatedAt: now
    },
    "key"
  );

  for (const visibleProject of packageProjects) {
    const visibleProjectTitle = cleanText(visibleProject.title) || "Untitled ChatGPT Project";
    const visibleProjectUrl = visibleProject.url || null;
    const visibleProjectKey = visibleProjectUrl || visibleProjectTitle;

    projects = upsertByKey(
      projects,
      {
        key: visibleProjectKey,
        title: visibleProjectTitle,
        instructions: visibleProject.instructions || "",
        notes: visibleProject.current ? packageData?.project?.notes || "" : "",
        accountKey,
        accountLabel: account.label,
        sourceUrl: visibleProjectUrl,
        updatedAt: now
      },
      "key"
    );
  }

  for (const chat of packageData?.chats || []) {
    const chatUrl = chat.url || sourceUrl || `${projectKey}#current`;
    const chatKey = `${accountKey}:${chatUrl}`;
    chats = upsertByKey(
      chats,
      {
        key: chatKey,
        url: chatUrl,
        title: cleanText(chat.title) || "Untitled chat",
        projectKey,
        accountKey,
        accountLabel: account.label,
        updatedAt: now
      },
      "key"
    );
  }

  const defaultChatUrl = sourceUrl || `${projectKey}#current`;
  const defaultChatKey = `${accountKey}:${defaultChatUrl}`;
  const existingMessageKeys = new Set(messages.map(messageKey));

  for (const message of packageData?.messages || []) {
    const nextMessage: MessageRecord = {
      id: messageKey({
        chatUrl: defaultChatKey,
        role: message.role || "message",
        text: message.text || ""
      }),
      chatUrl: defaultChatUrl,
      chatKey: defaultChatKey,
      projectKey,
      accountKey,
      accountLabel: account.label,
      role: message.role || "message",
      text: cleanText(message.text),
      capturedAt: packageData?.createdAt || now
    };

    if (!nextMessage.text || existingMessageKeys.has(nextMessage.id)) continue;

    existingMessageKeys.add(nextMessage.id);
    messages = [...messages, nextMessage];
  }

  for (const file of packageData?.files || []) {
    const key = fileKey(file);
    if (!key) continue;

    files = upsertByKey(
      files,
      {
        ...file,
        key,
        projectKey,
        accountKey,
        accountLabel: account.label,
        chatUrl: (file.chatUrl as string | null | undefined) || defaultChatUrl,
        chatKey: (file.chatKey as string | undefined) || defaultChatKey,
        capturedAt: packageData?.createdAt || now
      },
      "key"
    );
  }

  return {
    ...archive,
    schemaVersion: "0.2",
    app: "chatgpt-sync",
    mode: "offline-archive",
    lastSyncedAt: now,
    projects,
    accounts,
    chats,
    messages,
    files
  };
}

export function summarizeArchive(archive: Partial<OfflineArchive> | null | undefined): ArchiveSummary {
  return {
    projects: archive?.projects?.length || 0,
    accounts: archive?.accounts?.length || 0,
    chats: archive?.chats?.length || 0,
    messages: archive?.messages?.length || 0,
    files: archive?.files?.length || 0,
    lastSyncedAt: archive?.lastSyncedAt || null
  };
}

function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderOfflineChatHtml(archive: Partial<OfflineArchive> | null | undefined): string {
  const projects = archive?.projects || [];
  const chats = archive?.chats || [];
  const messages = archive?.messages || [];

  if (!projects.length && !chats.length && !messages.length) {
    return `<section class="empty-state">No offline chats cached yet.</section>`;
  }

  return projects
    .map((project) => {
      const projectChats = chats.filter((chat) => chat.projectKey === project.key);
      const chatBlocks = projectChats.length
        ? projectChats.map((chat) => renderChatBlock(chat, messages)).join("")
        : renderChatBlock(
            {
              title: "Current visible chat",
              url: project.sourceUrl,
              projectKey: project.key
            },
            messages
          );

      return `
        <section class="project">
          <header class="project-header">
            <div>
              <span class="eyebrow">Project</span>
              <h2>${escapeHtml(project.title)}</h2>
            </div>
            <span class="sync-time">${escapeHtml(project.updatedAt || "")}</span>
          </header>
          ${project.instructions ? `<p class="instructions">${escapeHtml(project.instructions)}</p>` : ""}
          ${chatBlocks}
        </section>
      `;
    })
    .join("");
}

function renderChatBlock(chat: Partial<ChatRecord>, messages: MessageRecord[]): string {
  const chatMessages = messages.filter(
    (message) => message.chatKey === chat.key || message.chatUrl === chat.url
  );
  const messageHtml = chatMessages.length
    ? chatMessages
        .map(
          (message) => `
            <article class="message ${escapeHtml(message.role)}">
              <div class="role">${escapeHtml(message.role)}</div>
              <p>${escapeHtml(message.text)}</p>
            </article>
          `
        )
        .join("")
    : `<article class="message muted"><p>No visible messages cached for this chat yet.</p></article>`;

  return `
    <section class="chat">
      <h3>${escapeHtml(chat.title || "Untitled chat")}</h3>
      ${messageHtml}
    </section>
  `;
}

// Content script. Runs inside the ChatGPT tab as a classic (non-module) script,
// so it must not use import/export — it stays a single self-contained IIFE.
// It scrapes the visible DOM and, when a signed-in session is available, reads
// ChatGPT's same-origin backend endpoints. It never reads or stores credentials.
(() => {
  interface ChatLink {
    title: string;
    url: string;
  }

  interface ProjectLink {
    title: string;
    url: string;
    current?: boolean;
  }

  interface VisibleMessage {
    role: string;
    text: string;
    createTime?: number | null;
  }

  interface VisibleFile {
    id: string;
    name: string;
    mimeType: string | null;
    width?: number | null;
    height?: number | null;
    sizeBytes?: number | null;
    conversationId?: string;
    sourceDownloadPath?: string;
    previewStatus?: string;
  }

  interface AccountIdentity {
    key: string;
    label: string;
    email?: string;
  }

  function cleanText(value: unknown): string {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getPageTitle(): string {
    const h1 = document.querySelector<HTMLElement>("h1");
    const title = cleanText(h1?.innerText || document.title);

    if (!title) return "Untitled ChatGPT Project";
    return title.replace(" | ChatGPT", "");
  }

  function detectProjectTitle(): string {
    const url = window.location.href;

    const candidates = [
      document.querySelector<HTMLElement>('[data-testid="project-title"]'),
      document.querySelector<HTMLElement>("h1"),
      document.querySelector<HTMLElement>("main h1")
    ];

    for (const element of candidates) {
      const text = cleanText(element?.innerText || element?.textContent);
      if (text) return text;
    }

    if (url.includes("/project")) return getPageTitle();

    return "";
  }

  function scanVisibleChats(): ChatLink[] {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]'));

    const unique = new Map<string, ChatLink>();

    for (const link of links) {
      const href = link.href;
      const title = cleanText(link.innerText || link.getAttribute("aria-label"));

      if (!href || unique.has(href)) continue;

      unique.set(href, {
        title: title || "Untitled chat",
        url: href
      });
    }

    return Array.from(unique.values());
  }

  function scanVisibleProjects(): ProjectLink[] {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        [
          'a[href*="/g/"]',
          'a[href*="/project"]'
        ].join(",")
      )
    );

    const unique = new Map<string, ProjectLink>();
    const titleKeys = new Map<string, string>();

    for (const link of links) {
      const href = link.href;
      const title = cleanText(link.innerText || link.getAttribute("aria-label"));
      const titleKey = title.toLowerCase();
      const key = titleKeys.get(titleKey) || href;

      if (!href || !title) continue;

      if (unique.has(key)) {
        const existing = unique.get(key)!;
        if (href.includes("/g/") || href.includes("/project")) {
          existing.url = href;
        }
        continue;
      }

      titleKeys.set(titleKey, key);
      unique.set(key, {
        title,
        url: href
      });
    }

    const currentTitle = detectProjectTitle();
    const currentUrl = window.location.href;

    if (currentTitle) {
      const titleKey = currentTitle.toLowerCase();
      const key = titleKeys.get(titleKey) || currentUrl;

      if (unique.has(key)) {
        unique.get(key)!.current = true;
      } else {
        titleKeys.set(titleKey, key);
        unique.set(key, {
          title: currentTitle,
          url: currentUrl,
          current: true
        });
      }
    }

    return Array.from(unique.values());
  }

  function detectRoleFromElement(element: Element): string {
    const testId = element.getAttribute("data-testid") || "";
    const aria = element.getAttribute("aria-label") || "";
    const text = `${testId} ${aria}`.toLowerCase();

    if (text.includes("user")) return "user";
    if (text.includes("assistant")) return "assistant";

    return "message";
  }

  function scanVisibleMessages(): VisibleMessage[] {
    const selectors = [
      "[data-message-author-role]",
      '[data-testid*="conversation-turn"]',
      "main article",
      "main [role='article']"
    ];

    const found: VisibleMessage[] = [];

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));

      for (const element of elements) {
        const text = cleanText(element.innerText || element.textContent);

        if (!text || text.length < 3) continue;

        const role =
          element.getAttribute("data-message-author-role") ||
          detectRoleFromElement(element);

        found.push({
          role,
          text
        });
      }

      if (found.length) break;
    }

    const seen = new Set<string>();

    return found.filter((item) => {
      const key = `${item.role}:${item.text.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scanProjectInstructions(): string {
    const possibleLabels = [
      "project instructions",
      "instructions",
      "custom instructions"
    ];

    const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"));

    for (const textarea of textareas) {
      const labelText = cleanText(
        textarea.closest("label")?.innerText ||
        textarea.parentElement?.innerText ||
        ""
      ).toLowerCase();

      if (possibleLabels.some((label) => labelText.includes(label))) {
        return textarea.value || "";
      }
    }

    return "";
  }

  function scanVisibleFiles(): VisibleFile[] {
    return Array.from(document.querySelectorAll<HTMLImageElement>("main img"))
      .map((image, index) => {
        const name =
          cleanText(image.getAttribute("alt")) ||
          `Visible image ${index + 1}`;

        return {
          id: `visible-image-${index + 1}-${name}`,
          name,
          mimeType: "image/*",
          width: image.naturalWidth || image.width || null,
          height: image.naturalHeight || image.height || null,
          previewStatus: "placeholder-only"
        };
      });
  }

  function extractEmail(value: unknown): string {
    const match = String(value || "").match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    return match ? match[0] : "";
  }

  // Labels like "Open project options for X", "Delete chat", "New project" are
  // controls, not the account. These are what the old selector accidentally grabbed.
  function looksLikeActionLabel(label: unknown): boolean {
    const text = String(label || "").toLowerCase();
    const actionWords = [
      "option",
      "menu",
      "گزینه",
      "باز کردن",
      "delete",
      "حذف",
      "rename",
      "تغییر نام",
      "archive",
      "بایگانی",
      "share",
      "اشتراک",
      "new chat",
      "new project",
      "چت جدید",
      "settings",
      "تنظیمات",
      "more",
      "بیشتر",
      "upgrade",
      "plans",
      "log in",
      "sign up"
    ];
    return actionWords.some((word) => text.includes(word));
  }

  // DOM-based account detection. This is only a fallback now -- scanPage prefers
  // the authenticated session API (see resolveAccount). It still avoids grabbing
  // sidebar action buttons and prefers anything that looks like an email.
  function detectAccount(): AccountIdentity {
    const ignored = new Set([
      "new chat",
      "search chats",
      "library",
      "apps",
      "codex",
      "more",
      "settings",
      "help"
    ]);
    const selectors = [
      '[data-testid="accounts-menu-button"]',
      '[data-testid="profile-button"]',
      'button[aria-label*="account" i]',
      'button[aria-label*="profile" i]'
    ];

    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const label = cleanText(element.innerText || element.getAttribute("aria-label"));

        const email = extractEmail(label);
        if (email) return { key: email.toLowerCase(), label: email };

        const key = label.toLowerCase();
        if (label && !ignored.has(key) && label.length >= 2 && !looksLikeActionLabel(label)) {
          return { key: key || window.location.hostname, label };
        }
      }
    }

    // Strong signal: an email rendered anywhere in the sidebar or account menu.
    for (const element of Array.from(document.querySelectorAll('nav *, aside *, [role="menu"] *'))) {
      const email = extractEmail(element.textContent);
      if (email) return { key: email.toLowerCase(), label: email };
    }

    return {
      key: window.location.hostname,
      label: "ChatGPT account"
    };
  }

  function extractConversationId(url: string = window.location.href): string {
    const match = String(url).match(/\/c\/([a-zA-Z0-9-]+)/);
    return match?.[1] || "";
  }

  function extractTextFromContent(content: any = {}): string {
    if (!content || typeof content !== "object") return "";

    if (Array.isArray(content.parts)) {
      return cleanText(
        content.parts
          .map((part: any) => {
            if (typeof part === "string") return part;
            if (part?.text) return part.text;
            if (part?.content_type === "text" && part?.text) return part.text;
            return "";
          })
          .filter(Boolean)
          .join("\n")
      );
    }

    if (content.text) return cleanText(content.text);

    return "";
  }

  function extractFileIdFromPointer(pointer: unknown = ""): string {
    const match = String(pointer).match(/file_[a-zA-Z0-9_]+/);
    return match?.[0] || "";
  }

  function createDownloadPath(fileId: string, conversationId: string): string {
    const params = new URLSearchParams({
      conversation_id: conversationId,
      inline: "false"
    });

    return `/backend-api/files/download/${fileId}?${params.toString()}`;
  }

  function collectMessageFiles(message: any, conversationId: string): VisibleFile[] {
    const files: VisibleFile[] = [];
    const seen = new Set<string>();

    function addFile(file: any = {}): void {
      const fileId =
        file.id ||
        file.file_id ||
        file.fileId ||
        extractFileIdFromPointer(file.asset_pointer || file.assetPointer || "");

      if (!fileId || seen.has(fileId)) return;
      seen.add(fileId);

      const mimeType = file.mime_type || file.mimeType || null;
      const isImage =
        String(mimeType || "").startsWith("image/") ||
        file.content_type === "image_asset_pointer" ||
        Boolean(file.width || file.height);

      files.push({
        id: fileId,
        name: file.name || file.file_name || file.filename || fileId,
        mimeType: mimeType || (isImage ? "image/*" : null),
        sizeBytes: file.size || file.size_bytes || file.file_size_bytes || null,
        width: file.width || null,
        height: file.height || null,
        conversationId,
        sourceDownloadPath: createDownloadPath(fileId, conversationId)
      });
    }

    for (const attachment of message?.metadata?.attachments || []) {
      addFile(attachment);
    }

    for (const part of message?.content?.parts || []) {
      if (typeof part === "string") continue;
      addFile(part);
    }

    return files;
  }

  function normalizeBackendConversation(data: any, pageUrl: string) {
    const conversationId = data?.conversation_id || extractConversationId(pageUrl);
    const nodes: any[] = Object.values(data?.mapping || {});
    const messages: VisibleMessage[] = [];
    const filesById = new Map<string, VisibleFile>();
    const skippedContentTypes = new Set([
      "model_editable_context",
      "thoughts",
      "reasoning_recap"
    ]);

    for (const node of nodes) {
      const message = node?.message;
      if (!message) continue;

      const role = message.author?.role || "message";
      const contentType = message.content?.content_type || "";
      const hidden = Boolean(message.metadata?.is_visually_hidden_from_conversation);

      for (const file of collectMessageFiles(message, conversationId)) {
        filesById.set(file.id, file);
      }

      if (hidden || role === "system" || skippedContentTypes.has(contentType)) continue;

      const text = extractTextFromContent(message.content);
      if (!text) continue;

      messages.push({
        id: message.id || node.id,
        role,
        text,
        createTime: message.create_time || null
      } as VisibleMessage);
    }

    messages.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

    return {
      title: data?.title || "",
      conversationId,
      projectId: data?.conversation_template_id || data?.gizmo_id || "",
      projectTitle: data?.title || "",
      messages,
      files: Array.from(filesById.values())
    };
  }

  async function scanBackendConversation() {
    const conversationId = extractConversationId();
    if (!conversationId || !window.location.hostname.includes("chatgpt.com")) {
      return null;
    }

    const targetPath = `/backend-api/conversation/${conversationId}`;
    const response = await fetch(targetPath, {
      credentials: "include",
      headers: {
        accept: "*/*",
        "x-openai-target-path": targetPath,
        "x-openai-target-route": "/backend-api/conversation/{conversation_id}"
      }
    });

    if (!response.ok) {
      throw new Error(`ChatGPT backend API returned ${response.status}`);
    }

    return normalizeBackendConversation(await response.json(), window.location.href);
  }

  function hasLoggedInDomMarkers(): boolean {
    return Boolean(
      document.querySelector('[data-testid="profile-button"]') ||
      document.querySelector('[data-testid="accounts-menu-button"]') ||
      document.querySelector('nav a[href*="/c/"]')
    );
  }

  function hasLoggedOutDomMarkers(): boolean {
    if (/\/auth\/(login|signup)/.test(window.location.pathname)) return true;

    const loginWords = new Set([
      "log in",
      "login",
      "sign in",
      "sign up",
      "get started for free"
    ]);

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a[href*="/auth/"], button, a[role="button"]')
    );

    for (const element of candidates) {
      const label = cleanText(element.innerText || element.getAttribute("aria-label")).toLowerCase();
      if (label && loginWords.has(label)) return true;
    }

    return false;
  }

  async function fetchSessionUser(): Promise<{ reachable: boolean; user?: any; detail?: string }> {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        headers: {
          accept: "application/json"
        }
      });

      if (!response.ok) {
        return { reachable: false, detail: `status ${response.status}` };
      }

      const data = await response.json().catch(() => ({}));
      const user = data && typeof data === "object" ? data.user : null;

      return { reachable: true, user: user || null };
    } catch (error) {
      return { reachable: false, detail: error.message };
    }
  }

  // Builds the canonical account identity from the signed-in session payload.
  // email is the stable grouping key so the offline reader groups by real account.
  function accountFromSessionUser(user: any): AccountIdentity | null {
    const email = cleanText(user?.email);
    const name = cleanText(user?.name);

    if (!email && !name) return null;

    return {
      key: (email || name).toLowerCase(),
      label: name || email || "ChatGPT account",
      email
    };
  }

  // Prefer the authenticated session for account identity; only fall back to the
  // DOM when the session API is unavailable.
  async function resolveAccount(): Promise<AccountIdentity> {
    try {
      const session = await fetchSessionUser();
      if (session.reachable) {
        const fromSession = accountFromSessionUser(session.user);
        if (fromSession) return fromSession;
      }
    } catch (_error) {
      // Ignore and fall back to DOM detection below.
    }

    return detectAccount();
  }

  async function checkLoginState() {
    const url = window.location.href;
    const session = await fetchSessionUser();

    if (session.reachable && session.user) {
      return {
        loggedIn: true,
        via: "session-api",
        account: accountFromSessionUser(session.user) || detectAccount(),
        url
      };
    }

    if (session.reachable && !session.user) {
      // chatgpt.com returns an empty payload when signed out -- authoritative.
      return { loggedIn: false, via: "session-api", account: null, url };
    }

    // Session endpoint unreachable: fall back to DOM heuristics, preferring the
    // safer "logged out" signal so we never scan an unauthenticated page.
    if (hasLoggedOutDomMarkers()) {
      return { loggedIn: false, via: "dom", account: null, url };
    }

    if (hasLoggedInDomMarkers()) {
      return { loggedIn: true, via: "dom", account: detectAccount(), url };
    }

    return {
      loggedIn: null,
      via: "unknown",
      account: null,
      url,
      detail: session.detail || "Could not determine ChatGPT login state."
    };
  }

  async function scanPage() {
    const visibleScan = {
      url: window.location.href,
      capturedAt: new Date().toISOString(),
      account: await resolveAccount(),
      project: {
        title: detectProjectTitle(),
        instructions: scanProjectInstructions()
      },
      projects: scanVisibleProjects(),
      chats: scanVisibleChats(),
      messages: scanVisibleMessages(),
      files: scanVisibleFiles()
    };

    try {
      const backendScan = await scanBackendConversation();
      if (!backendScan) return visibleScan;

      const chatUrl = `${window.location.origin}/c/${backendScan.conversationId}`;

      return {
        ...visibleScan,
        captureMethod: "chatgpt-backend-api",
        backendConversationId: backendScan.conversationId,
        backendProjectId: backendScan.projectId,
        project: {
          ...visibleScan.project,
          title: visibleScan.project.title || backendScan.projectTitle || backendScan.title,
          instructions: visibleScan.project.instructions
        },
        chats: [
          {
            title: backendScan.title || visibleScan.project.title || "Untitled chat",
            url: chatUrl,
            conversationId: backendScan.conversationId
          },
          ...visibleScan.chats
        ],
        messages: backendScan.messages.length ? backendScan.messages : visibleScan.messages,
        files: [
          ...backendScan.files,
          ...visibleScan.files.filter(
            (visibleFile) => !backendScan.files.some((file) => file.name === visibleFile.name)
          )
        ]
      };
    } catch (error) {
      return {
        ...visibleScan,
        backendApiError: error.message
      };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CHATGPT_SYNC_CHECK_LOGIN") {
      checkLoginState()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            loggedIn: null,
            via: "error",
            account: null,
            url: window.location.href,
            detail: error.message
          });
        });

      return true;
    }

    if (message?.type !== "CHATGPT_SYNC_SCAN_PAGE") return;

    scanPage()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          error: error.message,
          url: window.location.href,
          project: {
            title: "",
            instructions: ""
          },
          projects: [],
          chats: [],
          messages: []
        });
      });

    return true;
  });
})();

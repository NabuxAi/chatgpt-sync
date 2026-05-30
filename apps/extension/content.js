(() => {
  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getPageTitle() {
    const h1 = document.querySelector("h1");
    const title = cleanText(h1?.innerText || document.title);

    if (!title) return "Untitled ChatGPT Project";
    return title.replace(" | ChatGPT", "");
  }

  function detectProjectTitle() {
    const url = window.location.href;

    const candidates = [
      document.querySelector('[data-testid="project-title"]'),
      document.querySelector("h1"),
      document.querySelector("main h1")
    ];

    for (const element of candidates) {
      const text = cleanText(element?.innerText || element?.textContent);
      if (text) return text;
    }

    if (url.includes("/project")) return getPageTitle();

    return "";
  }

  function scanVisibleChats() {
    const links = Array.from(document.querySelectorAll('a[href*="/c/"]'));

    const unique = new Map();

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

  function scanVisibleProjects() {
    const links = Array.from(
      document.querySelectorAll(
        [
          'a[href*="/g/"]',
          'a[href*="/project"]'
        ].join(",")
      )
    );

    const unique = new Map();
    const titleKeys = new Map();

    for (const link of links) {
      const href = link.href;
      const title = cleanText(link.innerText || link.getAttribute("aria-label"));
      const titleKey = title.toLowerCase();
      const key = titleKeys.get(titleKey) || href;

      if (!href || !title) continue;

      if (unique.has(key)) {
        const existing = unique.get(key);
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
        unique.get(key).current = true;
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

  function detectRoleFromElement(element) {
    const testId = element.getAttribute("data-testid") || "";
    const aria = element.getAttribute("aria-label") || "";
    const text = `${testId} ${aria}`.toLowerCase();

    if (text.includes("user")) return "user";
    if (text.includes("assistant")) return "assistant";

    return "message";
  }

  function scanVisibleMessages() {
    const selectors = [
      "[data-message-author-role]",
      '[data-testid*="conversation-turn"]',
      "main article",
      "main [role='article']"
    ];

    const found = [];

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));

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

    const seen = new Set();

    return found.filter((item) => {
      const key = `${item.role}:${item.text.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scanProjectInstructions() {
    const possibleLabels = [
      "project instructions",
      "instructions",
      "custom instructions"
    ];

    const textareas = Array.from(document.querySelectorAll("textarea"));

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

  function scanVisibleFiles() {
    return Array.from(document.querySelectorAll("main img"))
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

  function detectAccount() {
    const selectors = [
      '[data-testid="accounts-menu-button"]',
      'button[aria-label*="account" i]',
      'button[aria-label*="profile" i]',
      'nav button',
      'aside button'
    ];
    const ignored = new Set([
      "new chat",
      "search chats",
      "library",
      "apps",
      "codex",
      "more"
    ]);

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));

      for (const element of elements.reverse()) {
        const label = cleanText(element.innerText || element.getAttribute("aria-label"));
        const key = label.toLowerCase();

        if (!label || ignored.has(key) || label.length < 2) continue;

        return {
          key: key || window.location.hostname,
          label
        };
      }
    }

    return {
      key: window.location.hostname,
      label: "ChatGPT account"
    };
  }

  function extractConversationId(url = window.location.href) {
    const match = String(url).match(/\/c\/([a-zA-Z0-9-]+)/);
    return match?.[1] || "";
  }

  function extractTextFromContent(content = {}) {
    if (!content || typeof content !== "object") return "";

    if (Array.isArray(content.parts)) {
      return cleanText(
        content.parts
          .map((part) => {
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

  function extractFileIdFromPointer(pointer = "") {
    const match = String(pointer).match(/file_[a-zA-Z0-9_]+/);
    return match?.[0] || "";
  }

  function createDownloadPath(fileId, conversationId) {
    const params = new URLSearchParams({
      conversation_id: conversationId,
      inline: "false"
    });

    return `/backend-api/files/download/${fileId}?${params.toString()}`;
  }

  function collectMessageFiles(message, conversationId) {
    const files = [];
    const seen = new Set();

    function addFile(file = {}) {
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

  function normalizeBackendConversation(data, pageUrl) {
    const conversationId = data?.conversation_id || extractConversationId(pageUrl);
    const nodes = Object.values(data?.mapping || {});
    const messages = [];
    const filesById = new Map();
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
      });
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

  async function scanPage() {
    const visibleScan = {
      url: window.location.href,
      capturedAt: new Date().toISOString(),
      account: detectAccount(),
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

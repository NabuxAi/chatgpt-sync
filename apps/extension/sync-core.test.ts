import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_SYNC_PERIOD_MINUTES,
  MAX_AUTO_SYNC_PERIOD_MINUTES,
  MIN_AUTO_SYNC_PERIOD_MINUTES,
  buildMemoryPackage,
  createEmptyOfflineArchive,
  mergePackageIntoArchive,
  normalizeSyncIntervalMinutes,
  renderOfflineChatHtml
} from "./sync-core.ts";

test("buildMemoryPackage creates a restorable package from visible scan data", () => {
  const packageData = buildMemoryPackage(
    {
      url: "https://chatgpt.com/g/g-project",
      project: {
        title: "Research Project",
        instructions: "Answer with citations."
      },
      chats: [
        {
          title: "Planning",
          url: "https://chatgpt.com/c/one"
        }
      ],
      messages: [
        {
          role: "user",
          text: "What did we decide?"
        }
      ]
    },
    {
      notes: "Move before account closes.",
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  assert.equal(packageData.schemaVersion, "0.2");
  assert.equal(packageData.project.title, "Research Project");
  assert.equal(packageData.project.notes, "Move before account closes.");
  assert.equal(packageData.chats[0].title, "Planning");
  assert.equal(packageData.messages[0].text, "What did we decide?");
  assert.deepEqual(
    packageData.restore.steps.map((step) => step.id),
    ["create-project", "copy-instructions", "paste-archive", "reupload-files"]
  );
});

test("buildMemoryPackage keeps multiple visible projects from the ChatGPT sidebar", () => {
  const packageData = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/current",
      project: {
        title: "Current Project",
        instructions: ""
      },
      projects: [
        {
          title: "Current Project",
          url: "https://chatgpt.com/g/current"
        },
        {
          title: "Second Project",
          url: "https://chatgpt.com/g/second"
        }
      ],
      chats: [],
      messages: []
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  assert.equal(packageData.projects.length, 2);
  assert.equal(packageData.projects[1].title, "Second Project");
});

test("buildMemoryPackage stores backend API capture metadata and file records without credentials", () => {
  const packageData = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/one",
      captureMethod: "chatgpt-backend-api",
      backendConversationId: "one",
      backendProjectId: "g-project",
      project: {
        title: "API Chat",
        instructions: ""
      },
      chats: [
        {
          title: "API Chat",
          url: "https://chatgpt.com/c/one"
        }
      ],
      messages: [],
      files: [
        {
          id: "file_123",
          name: "slide.png",
          sourceDownloadPath:
            "/backend-api/files/download/file_123?conversation_id=one&inline=false"
        }
      ]
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  assert.equal(packageData.capture.method, "chatgpt-backend-api");
  assert.equal(packageData.capture.backendConversationId, "one");
  assert.equal(packageData.files[0].name, "slide.png");
  assert.doesNotMatch(JSON.stringify(packageData), /Bearer|session-token|cf_clearance|download_url/);
});

test("mergePackageIntoArchive stores visible projects separately", () => {
  const packageData = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/current",
      project: {
        title: "Current Project",
        instructions: ""
      },
      projects: [
        {
          title: "Current Project",
          url: "https://chatgpt.com/g/current"
        },
        {
          title: "Second Project",
          url: "https://chatgpt.com/g/second"
        }
      ],
      chats: [],
      messages: []
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  const archive = mergePackageIntoArchive(createEmptyOfflineArchive(), packageData, {
    now: "2026-05-29T10:01:00.000Z"
  });

  assert.equal(archive.projects.length, 2);
  assert.deepEqual(
    archive.projects.map((project) => project.title),
    ["Current Project", "Second Project"]
  );
});

test("mergePackageIntoArchive tracks cached chats by source account", () => {
  const firstPackage = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/shared",
      account: {
        key: "personal",
        label: "Personal account"
      },
      project: {
        title: "Personal Project",
        instructions: ""
      },
      chats: [
        {
          title: "Planning",
          url: "https://chatgpt.com/c/shared"
        }
      ],
      messages: []
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );
  const secondPackage = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/shared",
      account: {
        key: "work",
        label: "Work account"
      },
      project: {
        title: "Work Project",
        instructions: ""
      },
      chats: [
        {
          title: "Planning",
          url: "https://chatgpt.com/c/shared"
        }
      ],
      messages: []
    },
    {
      now: "2026-05-29T10:02:00.000Z"
    }
  );

  const archive = mergePackageIntoArchive(
    mergePackageIntoArchive(createEmptyOfflineArchive(), firstPackage, {
      now: "2026-05-29T10:01:00.000Z"
    }),
    secondPackage,
    {
      now: "2026-05-29T10:03:00.000Z"
    }
  );

  assert.deepEqual(
    archive.accounts.map((account) => account.label),
    ["Personal account", "Work account"]
  );
  assert.equal(archive.chats.length, 2);
  assert.deepEqual(
    archive.chats.map((chat) => chat.accountKey),
    ["personal", "work"]
  );
});

test("mergePackageIntoArchive keeps file records linked to the source chat", () => {
  const packageData = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/one",
      project: {
        title: "Research Project",
        instructions: ""
      },
      chats: [
        {
          title: "Planning",
          url: "https://chatgpt.com/c/one"
        }
      ],
      messages: [],
      files: [
        {
          id: "file_abc",
          name: "asset.png",
          sourceDownloadPath:
            "/backend-api/files/download/file_abc?conversation_id=one&inline=false"
        }
      ]
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  const archive = mergePackageIntoArchive(createEmptyOfflineArchive(), packageData, {
    now: "2026-05-29T10:01:00.000Z"
  });

  assert.equal(archive.files.length, 1);
  assert.equal(archive.files[0].projectKey, "https://chatgpt.com/c/one");
  assert.equal(archive.files[0].chatUrl, "https://chatgpt.com/c/one");
});

test("mergePackageIntoArchive attaches current chat messages to the current visible project", () => {
  const packageData = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/current-chat",
      project: {
        title: "Current Project",
        instructions: ""
      },
      projects: [
        {
          title: "Current Project",
          url: "https://chatgpt.com/g/current-project",
          current: true
        },
        {
          title: "Second Project",
          url: "https://chatgpt.com/g/second-project"
        }
      ],
      chats: [
        {
          title: "Current Chat",
          url: "https://chatgpt.com/c/current-chat"
        }
      ],
      messages: [
        {
          role: "assistant",
          text: "Visible answer"
        }
      ]
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  const archive = mergePackageIntoArchive(createEmptyOfflineArchive(), packageData, {
    now: "2026-05-29T10:01:00.000Z"
  });
  const currentProject = archive.projects.find((project) => project.title === "Current Project");

  assert.equal(archive.chats[0].projectKey, currentProject?.key);
  assert.equal(archive.messages[0].projectKey, currentProject?.key);
  assert.match(renderOfflineChatHtml(archive), /Visible answer/);
});

test("mergePackageIntoArchive keeps messages readable when the page URL has a query string", () => {
  // The captured tab href carries a query string, but the chat record is keyed
  // to the clean /c/<id> URL. Messages must still attach to that chat.
  const packageData = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/with-query?model=gpt-5&foo=bar",
      project: {
        title: "Query Project",
        instructions: ""
      },
      chats: [
        {
          title: "Conversation",
          url: "https://chatgpt.com/c/with-query"
        }
      ],
      messages: [
        {
          role: "assistant",
          text: "This message must not be orphaned."
        }
      ]
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  const archive = mergePackageIntoArchive(createEmptyOfflineArchive(), packageData, {
    now: "2026-05-29T10:01:00.000Z"
  });

  const chat = archive.chats.find((entry) => entry.url === "https://chatgpt.com/c/with-query");
  assert.ok(chat, "the clean conversation chat is stored");
  const message = archive.messages[0];
  assert.equal(message.chatKey, chat?.key);
  assert.match(renderOfflineChatHtml(archive), /This message must not be orphaned\./);
});

test("mergePackageIntoArchive deduplicates chats and visible messages across automatic syncs", () => {
  const firstPackage = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/one",
      project: {
        title: "Research Project",
        instructions: ""
      },
      chats: [
        {
          title: "Planning",
          url: "https://chatgpt.com/c/one"
        }
      ],
      messages: [
        {
          role: "assistant",
          text: "The cached answer."
        }
      ]
    },
    {
      now: "2026-05-29T10:00:00.000Z"
    }
  );

  const secondPackage = buildMemoryPackage(
    {
      url: "https://chatgpt.com/c/one",
      project: {
        title: "Research Project",
        instructions: "Updated instructions"
      },
      chats: [
        {
          title: "Planning renamed",
          url: "https://chatgpt.com/c/one"
        }
      ],
      messages: [
        {
          role: "assistant",
          text: "The cached answer."
        },
        {
          role: "user",
          text: "New visible question."
        }
      ]
    },
    {
      now: "2026-05-29T10:03:00.000Z"
    }
  );

  const firstArchive = mergePackageIntoArchive(createEmptyOfflineArchive(), firstPackage, {
    now: "2026-05-29T10:01:00.000Z"
  });
  const secondArchive = mergePackageIntoArchive(firstArchive, secondPackage, {
    now: "2026-05-29T10:04:00.000Z"
  });

  assert.equal(secondArchive.lastSyncedAt, "2026-05-29T10:04:00.000Z");
  assert.equal(secondArchive.projects.length, 1);
  assert.equal(secondArchive.projects[0].instructions, "Updated instructions");
  assert.equal(secondArchive.chats.length, 1);
  assert.equal(secondArchive.chats[0].title, "Planning renamed");
  assert.equal(secondArchive.messages.length, 2);
});

test("renderOfflineChatHtml escapes cached content for the static offline reader", () => {
  const archive = mergePackageIntoArchive(
    createEmptyOfflineArchive(),
    buildMemoryPackage(
      {
        url: "https://chatgpt.com/c/one",
        project: {
          title: "<Project>",
          instructions: ""
        },
        chats: [
          {
            title: "<Planning>",
            url: "https://chatgpt.com/c/one"
          }
        ],
        messages: [
          {
            role: "assistant",
            text: "<script>alert('xss')</script>"
          }
        ]
      },
      {
        now: "2026-05-29T10:00:00.000Z"
      }
    ),
    {
      now: "2026-05-29T10:01:00.000Z"
    }
  );

  const html = renderOfflineChatHtml(archive);

  assert.match(html, /&lt;Project&gt;/);
  assert.match(html, /&lt;Planning&gt;/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("AUTO_SYNC_PERIOD_MINUTES keeps automatic sync conservative", () => {
  assert.ok(AUTO_SYNC_PERIOD_MINUTES >= 10);
});

test("normalizeSyncIntervalMinutes clamps, rounds, and falls back to the default", () => {
  // Sane defaults and bounds.
  assert.ok(MIN_AUTO_SYNC_PERIOD_MINUTES <= AUTO_SYNC_PERIOD_MINUTES);
  assert.ok(AUTO_SYNC_PERIOD_MINUTES <= MAX_AUTO_SYNC_PERIOD_MINUTES);

  // In-range values pass through (rounded).
  assert.equal(normalizeSyncIntervalMinutes(30), 30);
  assert.equal(normalizeSyncIntervalMinutes(12.6), 13);
  assert.equal(normalizeSyncIntervalMinutes("45"), 45);

  // Out-of-range values clamp to the bounds.
  assert.equal(normalizeSyncIntervalMinutes(1), MIN_AUTO_SYNC_PERIOD_MINUTES);
  assert.equal(normalizeSyncIntervalMinutes(0), MIN_AUTO_SYNC_PERIOD_MINUTES);
  assert.equal(normalizeSyncIntervalMinutes(100000), MAX_AUTO_SYNC_PERIOD_MINUTES);

  // Non-numeric input falls back to the default.
  assert.equal(normalizeSyncIntervalMinutes("not a number"), AUTO_SYNC_PERIOD_MINUTES);
  assert.equal(normalizeSyncIntervalMinutes(undefined), AUTO_SYNC_PERIOD_MINUTES);
  assert.equal(normalizeSyncIntervalMinutes(NaN), AUTO_SYNC_PERIOD_MINUTES);
});

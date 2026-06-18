import test from "node:test";
import assert from "node:assert/strict";

import { DEEP_SYNC_WAIT_MS, planDeepSyncTargets, planNewChatTargets } from "./deep-sync-planner.ts";

test("planDeepSyncTargets opens visible projects before chats and deduplicates urls", () => {
  const targets = planDeepSyncTargets({
    projects: [
      {
        title: "Project A",
        url: "https://chatgpt.com/g/a",
        current: true
      },
      {
        title: "Project B",
        url: "https://chatgpt.com/g/b"
      },
      {
        title: "Project A duplicate",
        url: "https://chatgpt.com/g/a"
      }
    ],
    chats: [
      {
        title: "Chat A",
        url: "https://chatgpt.com/c/a"
      },
      {
        title: "Chat A duplicate",
        url: "https://chatgpt.com/c/a"
      }
    ]
  });

  assert.deepEqual(
    targets.map((target) => [target.kind, target.url, target.waitMs]),
    [
      ["project", "https://chatgpt.com/g/a", DEEP_SYNC_WAIT_MS],
      ["project", "https://chatgpt.com/g/b", DEEP_SYNC_WAIT_MS],
      ["chat", "https://chatgpt.com/c/a", DEEP_SYNC_WAIT_MS]
    ]
  );
});

test("planDeepSyncTargets limits long queues to keep the extension responsive", () => {
  const projects = Array.from({ length: 40 }, (_, index) => ({
    title: `Project ${index}`,
    url: `https://chatgpt.com/g/${index}`
  }));

  const targets = planDeepSyncTargets({ projects }, { limit: 12 });

  assert.equal(targets.length, 12);
  assert.equal(targets[11].url, "https://chatgpt.com/g/11");
});

test("planNewChatTargets adds chats discovered after opening a project page", () => {
  const seen = new Set(["https://chatgpt.com/c/already-known"]);
  const targets = planNewChatTargets(
    {
      chats: [
        {
          title: "Already known",
          url: "https://chatgpt.com/c/already-known"
        },
        {
          title: "New project chat",
          url: "https://chatgpt.com/c/new-project-chat"
        }
      ]
    },
    seen
  );

  assert.deepEqual(
    targets.map((target) => target.url),
    ["https://chatgpt.com/c/new-project-chat"]
  );
  assert.ok(seen.has("https://chatgpt.com/c/new-project-chat"));
});

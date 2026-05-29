import { GENTLE_SYNC_LOAD_SETTLE_MS, GENTLE_SYNC_TARGET_LIMIT } from "./gentle-sync-policy.js";

export const DEEP_SYNC_WAIT_MS = GENTLE_SYNC_LOAD_SETTLE_MS;
export const DEEP_SYNC_TARGET_LIMIT = GENTLE_SYNC_TARGET_LIMIT;

function addTarget(targets, seen, target) {
  if (!target?.url || seen.has(target.url)) return;

  seen.add(target.url);
  targets.push({
    kind: target.kind,
    title: target.title || "",
    url: target.url,
    waitMs: target.waitMs || DEEP_SYNC_WAIT_MS
  });
}

export function planDeepSyncTargets(scanData = {}, options = {}) {
  const limit = options.limit || DEEP_SYNC_TARGET_LIMIT;
  const targets = [];
  const seen = new Set();

  for (const project of scanData.projects || []) {
    addTarget(targets, seen, {
      kind: "project",
      title: project.title,
      url: project.url
    });
  }

  for (const chat of scanData.chats || []) {
    addTarget(targets, seen, {
      kind: "chat",
      title: chat.title,
      url: chat.url
    });
  }

  return targets.slice(0, limit);
}

export function planNewChatTargets(scanData = {}, seenUrls = new Set(), options = {}) {
  const limit = options.limit || DEEP_SYNC_TARGET_LIMIT;
  const targets = [];

  for (const chat of scanData.chats || []) {
    addTarget(targets, seenUrls, {
      kind: "chat",
      title: chat.title,
      url: chat.url
    });
  }

  return targets.slice(0, limit);
}

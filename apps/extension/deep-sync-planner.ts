import { GENTLE_SYNC_LOAD_SETTLE_MS, GENTLE_SYNC_TARGET_LIMIT } from "./gentle-sync-policy.ts";
import type { ChatScan, ProjectScan, SyncTarget } from "./types.ts";

export const DEEP_SYNC_WAIT_MS = GENTLE_SYNC_LOAD_SETTLE_MS;
export const DEEP_SYNC_TARGET_LIMIT = GENTLE_SYNC_TARGET_LIMIT;

interface TargetSeed {
  kind: SyncTarget["kind"];
  title?: string;
  url?: string | null;
  waitMs?: number;
}

interface PlanOptions {
  limit?: number;
}

function addTarget(targets: SyncTarget[], seen: Set<string>, target: TargetSeed): void {
  if (!target?.url || seen.has(target.url)) return;

  seen.add(target.url);
  targets.push({
    kind: target.kind,
    title: target.title || "",
    url: target.url,
    waitMs: target.waitMs || DEEP_SYNC_WAIT_MS
  });
}

export function planDeepSyncTargets(
  scanData: { projects?: ProjectScan[]; chats?: ChatScan[] } = {},
  options: PlanOptions = {}
): SyncTarget[] {
  const limit = options.limit || DEEP_SYNC_TARGET_LIMIT;
  const targets: SyncTarget[] = [];
  const seen = new Set<string>();

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

export function planNewChatTargets(
  scanData: { chats?: ChatScan[] } = {},
  seenUrls: Set<string> = new Set(),
  options: PlanOptions = {}
): SyncTarget[] {
  const limit = options.limit || DEEP_SYNC_TARGET_LIMIT;
  const targets: SyncTarget[] = [];

  for (const chat of scanData.chats || []) {
    addTarget(targets, seenUrls, {
      kind: "chat",
      title: chat.title,
      url: chat.url
    });
  }

  return targets.slice(0, limit);
}

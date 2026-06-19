import { AUTO_SYNC_PERIOD_MINUTES, normalizeSyncIntervalMinutes } from "./sync-core.ts";

// User settings live in chrome.storage.local. Keep this module a thin wrapper so
// the pure validation logic stays in sync-core (and stays unit-tested).

export const SYNC_INTERVAL_KEY = "chatgpt-sync:auto-sync-interval-minutes";

/** The auto-sync interval in minutes, falling back to the default when unset. */
export async function loadSyncIntervalMinutes(): Promise<number> {
  const data = await chrome.storage.local.get(SYNC_INTERVAL_KEY);
  const stored = data[SYNC_INTERVAL_KEY];
  return stored == null ? AUTO_SYNC_PERIOD_MINUTES : normalizeSyncIntervalMinutes(stored);
}

/** Persist a (normalized) auto-sync interval and return the value that was saved. */
export async function saveSyncIntervalMinutes(value: unknown): Promise<number> {
  const minutes = normalizeSyncIntervalMinutes(value);
  await chrome.storage.local.set({ [SYNC_INTERVAL_KEY]: minutes });
  return minutes;
}

import { createEmptyOfflineArchive, mergePackageIntoArchive } from "./sync-core.js";

export const OFFLINE_ARCHIVE_KEY = "chatgpt-sync:offline-archive";

export async function loadOfflineArchive() {
  const data = await chrome.storage.local.get(OFFLINE_ARCHIVE_KEY);
  return data[OFFLINE_ARCHIVE_KEY] || createEmptyOfflineArchive();
}

export async function saveOfflineArchive(archive) {
  await chrome.storage.local.set({
    [OFFLINE_ARCHIVE_KEY]: archive
  });
}

export async function mergeAndSaveOfflineArchive(packageData, options = {}) {
  const archive = await loadOfflineArchive();
  const merged = mergePackageIntoArchive(archive, packageData, options);
  await saveOfflineArchive(merged);
  return merged;
}

export async function clearOfflineArchive() {
  await chrome.storage.local.remove(OFFLINE_ARCHIVE_KEY);
}

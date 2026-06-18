import { createEmptyOfflineArchive, mergePackageIntoArchive } from "./sync-core.ts";
import type { BuildOptions, MemoryPackage, OfflineArchive } from "./types.ts";

export const OFFLINE_ARCHIVE_KEY = "chatgpt-sync:offline-archive";

export async function loadOfflineArchive(): Promise<OfflineArchive> {
  const data = await chrome.storage.local.get(OFFLINE_ARCHIVE_KEY);
  return (data[OFFLINE_ARCHIVE_KEY] as OfflineArchive) || createEmptyOfflineArchive();
}

export async function saveOfflineArchive(archive: OfflineArchive): Promise<void> {
  await chrome.storage.local.set({
    [OFFLINE_ARCHIVE_KEY]: archive
  });
}

export async function mergeAndSaveOfflineArchive(
  packageData: MemoryPackage,
  options: BuildOptions = {}
): Promise<OfflineArchive> {
  const archive = await loadOfflineArchive();
  const merged = mergePackageIntoArchive(archive, packageData, options);
  await saveOfflineArchive(merged);
  return merged;
}

export async function clearOfflineArchive(): Promise<void> {
  await chrome.storage.local.remove(OFFLINE_ARCHIVE_KEY);
}

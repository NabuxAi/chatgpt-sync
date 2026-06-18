import type { MemoryPackage } from "./types.ts";

const VAULT_KEY = "chatgpt-sync:memory-package";

export async function saveToSession(packageData: MemoryPackage): Promise<void> {
  await chrome.storage.session.set({
    [VAULT_KEY]: packageData
  });
}

export async function loadFromSession(): Promise<MemoryPackage | null> {
  const data = await chrome.storage.session.get(VAULT_KEY);
  return (data[VAULT_KEY] as MemoryPackage) || null;
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(VAULT_KEY);
}

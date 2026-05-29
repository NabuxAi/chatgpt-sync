const VAULT_KEY = "chatgpt-sync:memory-package";

export async function saveToSession(packageData) {
  await chrome.storage.session.set({
    [VAULT_KEY]: packageData
  });
}

export async function loadFromSession() {
  const data = await chrome.storage.session.get(VAULT_KEY);
  return data[VAULT_KEY] || null;
}

export async function clearSession() {
  await chrome.storage.session.remove(VAULT_KEY);
}

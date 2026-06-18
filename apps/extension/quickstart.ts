export {};

// Cross-browser API alias: Firefox exposes promise-based `browser`, Chrome uses
// promise-based `chrome` (MV3). Picking `browser` first keeps one code path.
const ext: any = (globalThis as any).browser ?? globalThis.chrome;

const $ = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;

async function openUrl(url: string): Promise<void> {
  try {
    await ext.tabs.create({ url });
  } catch (_error) {
    window.open(url, "_blank", "noopener");
  }
}

async function closeSelf(): Promise<void> {
  try {
    const tab = await ext.tabs.getCurrent();
    if (tab?.id != null) {
      await ext.tabs.remove(tab.id);
      return;
    }
  } catch (_error) {
    // Fall through to window.close().
  }
  window.close();
}

$("#openChatGpt").addEventListener("click", () => {
  openUrl("https://chatgpt.com/");
});

$("#openOfflineReader").addEventListener("click", () => {
  openUrl(ext.runtime.getURL("offline.html"));
});

$("#closeQuickStart").addEventListener("click", () => {
  closeSelf();
});

(() => {
  const appName = "ChatGPT Sync";

  function getVisibleProjectTitle() {
    const candidates = [
      document.querySelector("h1"),
      document.querySelector('[data-testid="project-title"]'),
      document.querySelector("title")
    ];

    for (const element of candidates) {
      const text = element?.innerText || element?.textContent;
      if (text && text.trim()) return text.trim();
    }

    return null;
  }

  chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CHATGPT_SYNC_READ_VISIBLE_PROJECT") return;

    sendResponse({
      app: appName,
      title: getVisibleProjectTitle(),
      url: window.location.href
    });
  });
})();

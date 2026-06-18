import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = resolve(import.meta.dirname, "..");
// The browser loads the *built* extension. Run `npm run build` first.
const extensionPath = resolve(root, "apps/extension/dist");
const artifactDir = resolve(root, "tmp/live-extension-test");
const userDataDir = resolve(artifactDir, "profile");

if (!existsSync(resolve(extensionPath, "manifest.json"))) {
  throw new Error(
    `Built extension not found at ${extensionPath}. Run \`npm run build\` before the live runner.`
  );
}

function pageHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title} | ChatGPT</title>
  </head>
  <body>
    <main>
      ${body}
    </main>
  </body>
</html>`;
}

const fakeChatHtml = pageHtml(
  "Live Test Project",
  `
      <h1 data-testid="project-title">Live Test Project</h1>
      <nav>
        <a href="https://chatgpt.com/g/live-test-project">Live Test Project</a>
        <a href="https://chatgpt.com/g/second-project">Second Visible Project</a>
        <a href="https://chatgpt.com/c/live-test">Live Test Chat</a>
      </nav>
      <article data-message-author-role="user">Can I read this later offline?</article>
      <article data-message-author-role="assistant">Yes. This response should be cached locally.</article>
  `
);

const fakeProjectHtml = pageHtml(
  "Live Test Project",
  `
      <h1 data-testid="project-title">Live Test Project</h1>
      <nav>
        <a href="https://chatgpt.com/c/live-test">Live Test Chat</a>
        <a href="https://chatgpt.com/c/project-discovered-chat">Project Discovered Chat</a>
      </nav>
  `
);

const fakeSecondProjectHtml = pageHtml(
  "Second Visible Project",
  `
      <h1 data-testid="project-title">Second Visible Project</h1>
      <nav>
        <a href="https://chatgpt.com/c/second-project-chat">Second Project Chat</a>
      </nav>
  `
);

const fakeDiscoveredChatHtml = pageHtml(
  "Project Discovered Chat",
  `
      <h1 data-testid="project-title">Live Test Project</h1>
      <article data-message-author-role="user">This chat was only found after opening the project.</article>
      <article data-message-author-role="assistant">Deep sync waited and cached this project chat.</article>
  `
);

const fakeSecondProjectChatHtml = pageHtml(
  "Second Project Chat",
  `
      <h1 data-testid="project-title">Second Visible Project</h1>
      <article data-message-author-role="user">Second project question.</article>
      <article data-message-author-role="assistant">Second project answer cached by deep sync.</article>
  `
);

await mkdir(artifactDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check"
  ]
});

try {
  await context.route("https://chatgpt.com/**", async (route: any) => {
    const url = new URL(route.request().url());
    const bodyByPath: Record<string, string> = {
      "/c/live-test": fakeChatHtml,
      "/g/live-test-project": fakeProjectHtml,
      "/g/second-project": fakeSecondProjectHtml,
      "/c/project-discovered-chat": fakeDiscoveredChatHtml,
      "/c/second-project-chat": fakeSecondProjectChatHtml
    };

    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: bodyByPath[url.pathname] || fakeChatHtml
    });
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    const extensionsPage = await context.newPage();
    await extensionsPage.goto("chrome://extensions");
    await extensionsPage.screenshot({
      path: resolve(artifactDir, "00-extensions-page.png"),
      fullPage: true
    });
    serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 30000 }));
    await extensionsPage.close();
  }
  const extensionId = new URL(serviceWorker.url()).host;

  const chatPage = await context.newPage();
  await chatPage.goto("https://chatgpt.com/c/live-test");
  await chatPage.waitForSelector('[data-message-author-role="assistant"]');
  await chatPage.screenshot({
    path: resolve(artifactDir, "01-fake-chatgpt-page.png"),
    fullPage: true
  });

  const scanData = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    const tab = tabs.find((candidate) => candidate.url.includes("/c/live-test"));
    if (!tab?.id) throw new Error("Live test tab was not found.");

    return chrome.tabs.sendMessage(tab.id, {
      type: "CHATGPT_SYNC_SCAN_PAGE"
    });
  });

  if (scanData.project.title !== "Live Test Project") {
    throw new Error(`Unexpected project title: ${scanData.project.title}`);
  }

  if (scanData.messages.length !== 2) {
    throw new Error(`Expected 2 messages, found ${scanData.messages.length}`);
  }

  if (scanData.projects.length !== 2) {
    throw new Error(`Expected 2 visible projects, found ${scanData.projects.length}`);
  }

  const offlinePage = await context.newPage();
  await offlinePage.goto(`chrome-extension://${extensionId}/offline.html`);
  const syncResult = await offlinePage.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: "CHATGPT_SYNC_RUN_AUTO_SYNC"
    });
  });

  if (!syncResult?.ok || syncResult.synced < 1) {
    throw new Error(`Auto sync failed: ${JSON.stringify(syncResult)}`);
  }

  await offlinePage.reload();
  await offlinePage.waitForSelector("text=Live Test Project");
  await offlinePage.waitForSelector("text=Yes. This response should be cached locally.");
  await offlinePage.screenshot({
    path: resolve(artifactDir, "02-offline-reader.png"),
    fullPage: true
  });

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.waitForSelector("text=ChatGPT Sync");
  await popupPage.screenshot({
    path: resolve(artifactDir, "03-popup.png"),
    fullPage: true
  });

  const summary = await offlinePage.evaluate(() => ({
    projects: document.querySelector("#offlineProjectCount")?.textContent,
    chats: document.querySelector("#offlineChatCount")?.textContent,
    messages: document.querySelector("#offlineMessageCount")?.textContent,
    lastSyncedAt: document.querySelector("#lastSyncedAt")?.textContent
  }));

  if (summary.projects !== "2" || summary.messages !== "2") {
    throw new Error(`Unexpected offline summary: ${JSON.stringify(summary)}`);
  }

  console.log(
    JSON.stringify(
      {
        extensionId,
        scanData,
        syncResult,
        summary,
        screenshots: [
          resolve(artifactDir, "01-fake-chatgpt-page.png"),
          resolve(artifactDir, "02-offline-reader.png"),
          resolve(artifactDir, "03-popup.png")
        ]
      },
      null,
      2
    )
  );
} finally {
  await Promise.race([
    context.close(),
    new Promise((resolveClose) => setTimeout(resolveClose, 3000))
  ]);
}

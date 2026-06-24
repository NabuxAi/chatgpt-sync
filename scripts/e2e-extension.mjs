#!/usr/bin/env node
// CI-friendly end-to-end test for the ChatGPT Sync extension.
//
// It loads the *built* extension (apps/extension/dist) into a real Chromium and
// drives the three core flows against a fully mocked ChatGPT origin:
//
//   • SYNC    — scanning an open ChatGPT tab caches it for offline reading.
//   • BACKUP  — the scan returns a portable package the popup can download.
//   • RESTORE — importing that package rebuilds a readable offline archive.
//
// The mock also serves /api/auth/session and /backend-api/conversation/<id> so
// the same-session API capture path (including its Authorization header) is
// exercised, not just the DOM fallback.
//
// Run it with:  npm run test:e2e
// Chromium with extensions needs a display, so the npm script wraps this in
// xvfb-run. Point at a specific browser with E2E_CHROME=/path/to/chrome.

import { mkdir, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "apps/extension/dist");
const artifactDir = resolve(root, "tmp/e2e");
const userDataDir = resolve(artifactDir, "profile");

if (!existsSync(resolve(extensionPath, "manifest.json"))) {
  throw new Error(
    `Built extension not found at ${extensionPath}. Run \`npm run build\` before the E2E runner.`
  );
}

// Resolve a usable Chromium: an explicit override, the locally extracted
// Playwright build, or Playwright's bundled default.
function resolveExecutablePath() {
  if (process.env.E2E_CHROME && existsSync(process.env.E2E_CHROME)) {
    return process.env.E2E_CHROME;
  }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const dir = readdirSync(base).find((name) => name.startsWith("chromium-"));
    if (dir) {
      const candidate = resolve(base, dir, "chrome-linux64/chrome");
      if (existsSync(candidate)) return candidate;
      const alt = resolve(base, dir, "chrome-linux/chrome");
      if (existsSync(alt)) return alt;
    }
  } catch {
    /* fall through to Playwright default */
  }
  return undefined; // let Playwright pick its bundled binary
}

const CONVERSATION_ID = "e2e-conversation";
const ACCOUNT_EMAIL = "e2e-user@example.com";
const ASSISTANT_TEXT = "Backend API answer cached for offline reading.";
const USER_TEXT = "Will the backend API capture this offline?";

function pageHtml(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>${title} | ChatGPT</title></head>
<body><main>${body}</main></body></html>`;
}

const chatHtml = pageHtml(
  "E2E Project",
  `<h1 data-testid="project-title">E2E Project</h1>
   <nav>
     <a href="https://chatgpt.com/g/e2e-project" aria-label="E2E Project">E2E Project</a>
     <a href="https://chatgpt.com/c/${CONVERSATION_ID}">E2E Conversation</a>
   </nav>
   <article data-message-author-role="user">${USER_TEXT}</article>
   <article data-message-author-role="assistant">A rendered fallback answer.</article>`
);

// Same-session conversation payload (ChatGPT backend-api shape).
const conversationPayload = {
  title: "E2E Conversation",
  conversation_id: CONVERSATION_ID,
  mapping: {
    a: {
      id: "a",
      message: {
        id: "a",
        author: { role: "user" },
        create_time: 1,
        content: { content_type: "text", parts: [USER_TEXT] }
      }
    },
    b: {
      id: "b",
      message: {
        id: "b",
        author: { role: "assistant" },
        create_time: 2,
        content: { content_type: "text", parts: [ASSISTANT_TEXT] }
      }
    }
  }
};

const seenAuthHeaders = [];

function assert(condition, message) {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`);
}

// Start from a clean profile so Chromium loads the freshly built extension
// instead of a service worker cached from a previous run.
await rm(userDataDir, { recursive: true, force: true });
await mkdir(artifactDir, { recursive: true });

const executablePath = resolveExecutablePath();
console.log(`Launching Chromium${executablePath ? ` (${executablePath})` : " (Playwright default)"}`);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check"
  ]
});

let failure = null;

try {
  await context.route(/https:\/\/chatgpt\.com\/.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/session") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { email: ACCOUNT_EMAIL, name: "E2E User" },
          accessToken: "e2e-access-token"
        })
      });
      return;
    }

    if (url.pathname.startsWith("/backend-api/conversation/")) {
      seenAuthHeaders.push(request.headers()["authorization"] || "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(conversationPayload)
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "text/html", body: chatHtml });
  });

  // --- Resolve the extension service worker + id ---------------------------
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 30000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  console.log(`Extension loaded: ${extensionId}`);

  // --- Open a signed-in ChatGPT conversation tab ---------------------------
  const chatPage = await context.newPage();
  await chatPage.goto(`https://chatgpt.com/c/${CONVERSATION_ID}`);
  await chatPage.waitForSelector('[data-message-author-role="assistant"]');

  // Runtime messages must come from an extension page (like the real popup) —
  // a service worker never receives its own runtime.sendMessage.
  const offlinePage = await context.newPage();
  await offlinePage.goto(`chrome-extension://${extensionId}/offline.html`);
  const sendToBackground = (message) =>
    offlinePage.evaluate((msg) => chrome.runtime.sendMessage(msg), message);

  // === SYNC + BACKUP: drive the popup's real "Scan Page" message ===========
  const scanResult = await sendToBackground({
    type: "CHATGPT_SYNC_SCAN_AND_SYNC",
    notes: "e2e"
  });
  assert(scanResult?.ok, `SCAN_AND_SYNC ok (got ${JSON.stringify(scanResult)})`);

  // BACKUP: the scan must hand the popup a downloadable package.
  const lastScan = await sendToBackground({ type: "CHATGPT_SYNC_GET_LAST_SCAN_RESULT" });
  assert(lastScan?.ok, "GET_LAST_SCAN_RESULT ok");
  assert(lastScan.result?.package, "scan produced a downloadable package");
  const pkg = lastScan.result.package;
  assert(
    pkg.messages.some((m) => m.text === ASSISTANT_TEXT),
    `package captured backend message (got ${JSON.stringify(pkg.messages?.map((m) => m.text))})`
  );

  // Same-session capture must have sent a bearer token.
  assert(
    seenAuthHeaders.some((h) => h.startsWith("Bearer ")),
    `backend-api request carried an Authorization bearer header (saw ${JSON.stringify(seenAuthHeaders)})`
  );

  // === SYNC: the offline reader shows the cached conversation ==============
  await offlinePage.reload();
  await offlinePage.waitForSelector(`text=${ASSISTANT_TEXT}`, { timeout: 10000 });
  await offlinePage.screenshot({ path: resolve(artifactDir, "offline-after-sync.png") });

  // === RESTORE: clear the archive, import the package, read it back ========
  await offlinePage.evaluate(
    async (vaultKey) => chrome.storage.local.remove(vaultKey),
    "chatgpt-sync:offline-archive"
  );
  await offlinePage.reload();
  const emptyState = await offlinePage.textContent("#chatList");
  assert(/No cached/i.test(emptyState || ""), "archive cleared before restore");

  const importResult = await sendToBackground({
    type: "CHATGPT_SYNC_IMPORT_PACKAGE",
    package: pkg
  });
  assert(importResult?.ok, `IMPORT_PACKAGE ok (got ${JSON.stringify(importResult)})`);

  await offlinePage.reload();
  await offlinePage.waitForSelector(`text=${ASSISTANT_TEXT}`, { timeout: 10000 });
  await offlinePage.screenshot({ path: resolve(artifactDir, "offline-after-restore.png") });

  console.log(
    JSON.stringify(
      {
        extensionId,
        messagesCaptured: pkg.messages.length,
        authHeaderSeen: seenAuthHeaders,
        result: "PASS"
      },
      null,
      2
    )
  );
} catch (error) {
  failure = error;
} finally {
  await Promise.race([
    context.close(),
    new Promise((res) => setTimeout(res, 3000))
  ]);
}

if (failure) {
  console.error(failure.stack || String(failure));
  process.exit(1);
}
console.log("E2E PASSED");

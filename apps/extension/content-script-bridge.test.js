import test from "node:test";
import assert from "node:assert/strict";

import { scanTabWithFallback, checkTabLogin } from "./content-script-bridge.js";

test("scanTabWithFallback injects content script when an existing ChatGPT tab has no receiver", async () => {
  const calls = [];
  let sendAttempts = 0;

  const chromeApi = {
    tabs: {
      async sendMessage(tabId, message) {
        calls.push(["sendMessage", tabId, message.type]);
        sendAttempts += 1;

        if (sendAttempts === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }

        return {
          url: "https://chatgpt.com/c/live",
          project: {
            title: "Injected Project",
            instructions: ""
          },
          chats: [],
          messages: []
        };
      }
    },
    scripting: {
      async executeScript(details) {
        calls.push(["executeScript", details.target.tabId, details.files[0]]);
      }
    }
  };

  const scanData = await scanTabWithFallback(chromeApi, 42);

  assert.equal(scanData.project.title, "Injected Project");
  assert.deepEqual(calls, [
    ["sendMessage", 42, "CHATGPT_SYNC_SCAN_PAGE"],
    ["executeScript", 42, "content.js"],
    ["sendMessage", 42, "CHATGPT_SYNC_SCAN_PAGE"]
  ]);
});

test("scanTabWithFallback shows a friendly error when active tab is not injectable", async () => {
  const chromeApi = {
    tabs: {
      async sendMessage() {
        throw new Error("No receiver");
      }
    },
    scripting: {
      async executeScript() {
        throw new Error("Cannot access contents of url chrome://extensions/");
      }
    }
  };

  await assert.rejects(
    () => scanTabWithFallback(chromeApi, 7),
    /Open or reload a ChatGPT tab/
  );
});

test("checkTabLogin asks the content script for the ChatGPT login state", async () => {
  const calls = [];

  const chromeApi = {
    tabs: {
      async sendMessage(tabId, message) {
        calls.push(["sendMessage", tabId, message.type]);

        return {
          loggedIn: true,
          via: "session-api",
          account: { key: "user@example.com", label: "Ada", email: "user@example.com" }
        };
      }
    },
    scripting: {
      async executeScript() {
        calls.push(["executeScript"]);
      }
    }
  };

  const login = await checkTabLogin(chromeApi, 11);

  assert.equal(login.loggedIn, true);
  assert.equal(login.account.email, "user@example.com");
  assert.deepEqual(calls, [["sendMessage", 11, "CHATGPT_SYNC_CHECK_LOGIN"]]);
});

test("checkTabLogin injects content.js when the tab has no receiver yet", async () => {
  const calls = [];
  let sendAttempts = 0;

  const chromeApi = {
    tabs: {
      async sendMessage(tabId, message) {
        calls.push(["sendMessage", tabId, message.type]);
        sendAttempts += 1;

        if (sendAttempts === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }

        return { loggedIn: false, via: "session-api", account: null };
      }
    },
    scripting: {
      async executeScript(details) {
        calls.push(["executeScript", details.target.tabId, details.files[0]]);
      }
    }
  };

  const login = await checkTabLogin(chromeApi, 99);

  assert.equal(login.loggedIn, false);
  assert.deepEqual(calls, [
    ["sendMessage", 99, "CHATGPT_SYNC_CHECK_LOGIN"],
    ["executeScript", 99, "content.js"],
    ["sendMessage", 99, "CHATGPT_SYNC_CHECK_LOGIN"]
  ]);
});

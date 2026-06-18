import type { LoginState, ScanData } from "./types.ts";

/**
 * The slice of the Chrome extension API this bridge needs. Kept minimal and
 * loose on purpose so unit tests can pass a small mock in place of `chrome`.
 */
export interface MessagingChromeApi {
  tabs: {
    sendMessage(tabId: number, message: any): Promise<any>;
  };
  scripting: {
    executeScript(details: any): Promise<any>;
  };
}

const SCAN_MESSAGE = {
  type: "CHATGPT_SYNC_SCAN_PAGE"
};

const CHECK_LOGIN_MESSAGE = {
  type: "CHATGPT_SYNC_CHECK_LOGIN"
};

function friendlyScanError(error: { message?: string } | null | undefined): Error {
  const detail = error?.message ? ` (${error.message})` : "";
  return new Error(`Open or reload a ChatGPT tab, then try Scan Page again.${detail}`);
}

async function sendTabMessage<T>(chromeApi: MessagingChromeApi, tabId: number, message: unknown): Promise<T> {
  const response = await chromeApi.tabs.sendMessage(tabId, message);

  if (response?.error) {
    throw new Error(response.error);
  }

  if (!response) {
    throw new Error("No response received from the ChatGPT tab.");
  }

  return response as T;
}

// Sends a message to the content script, injecting content.js once and retrying
// if the tab has no receiver yet (freshly opened or reloaded ChatGPT tab).
async function sendWithInjectFallback<T>(chromeApi: MessagingChromeApi, tabId: number, message: unknown): Promise<T> {
  try {
    return await sendTabMessage<T>(chromeApi, tabId, message);
  } catch (firstError) {
    try {
      await chromeApi.scripting.executeScript({
        target: {
          tabId
        },
        files: ["content.js"]
      });

      return await sendTabMessage<T>(chromeApi, tabId, message);
    } catch (secondError) {
      throw friendlyScanError((secondError || firstError) as { message?: string });
    }
  }
}

export async function scanTabWithFallback(chromeApi: MessagingChromeApi, tabId: number): Promise<ScanData> {
  return sendWithInjectFallback<ScanData>(chromeApi, tabId, SCAN_MESSAGE);
}

export async function checkTabLogin(chromeApi: MessagingChromeApi, tabId: number): Promise<LoginState> {
  return sendWithInjectFallback<LoginState>(chromeApi, tabId, CHECK_LOGIN_MESSAGE);
}

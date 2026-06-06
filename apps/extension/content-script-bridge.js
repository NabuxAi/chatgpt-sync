const SCAN_MESSAGE = {
  type: "CHATGPT_SYNC_SCAN_PAGE"
};

const CHECK_LOGIN_MESSAGE = {
  type: "CHATGPT_SYNC_CHECK_LOGIN"
};

function friendlyScanError(error) {
  const detail = error?.message ? ` (${error.message})` : "";
  return new Error(`Open or reload a ChatGPT tab, then try Scan Page again.${detail}`);
}

async function sendTabMessage(chromeApi, tabId, message) {
  const response = await chromeApi.tabs.sendMessage(tabId, message);

  if (response?.error) {
    throw new Error(response.error);
  }

  if (!response) {
    throw new Error("No response received from the ChatGPT tab.");
  }

  return response;
}

// Sends a message to the content script, injecting content.js once and retrying
// if the tab has no receiver yet (freshly opened or reloaded ChatGPT tab).
async function sendWithInjectFallback(chromeApi, tabId, message) {
  try {
    return await sendTabMessage(chromeApi, tabId, message);
  } catch (firstError) {
    try {
      await chromeApi.scripting.executeScript({
        target: {
          tabId
        },
        files: ["content.js"]
      });

      return await sendTabMessage(chromeApi, tabId, message);
    } catch (secondError) {
      throw friendlyScanError(secondError || firstError);
    }
  }
}

export async function scanTabWithFallback(chromeApi, tabId) {
  return sendWithInjectFallback(chromeApi, tabId, SCAN_MESSAGE);
}

export async function checkTabLogin(chromeApi, tabId) {
  return sendWithInjectFallback(chromeApi, tabId, CHECK_LOGIN_MESSAGE);
}

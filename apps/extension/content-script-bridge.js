const SCAN_MESSAGE = {
  type: "CHATGPT_SYNC_SCAN_PAGE"
};

function friendlyScanError(error) {
  const detail = error?.message ? ` (${error.message})` : "";
  return new Error(`Open or reload a ChatGPT tab, then try Scan Page again.${detail}`);
}

async function sendScanMessage(chromeApi, tabId) {
  const response = await chromeApi.tabs.sendMessage(tabId, SCAN_MESSAGE);

  if (response?.error) {
    throw new Error(response.error);
  }

  if (!response) {
    throw new Error("No scan response received.");
  }

  return response;
}

export async function scanTabWithFallback(chromeApi, tabId) {
  try {
    return await sendScanMessage(chromeApi, tabId);
  } catch (firstError) {
    try {
      await chromeApi.scripting.executeScript({
        target: {
          tabId
        },
        files: ["content.js"]
      });

      return await sendScanMessage(chromeApi, tabId);
    } catch (secondError) {
      throw friendlyScanError(secondError || firstError);
    }
  }
}

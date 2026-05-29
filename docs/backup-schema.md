# Backup Schema

ChatGPT Sync backups are plain JSON files. They should be readable, portable, and safe to inspect.

## File extension

Recommended extension:

```txt
.chatgpt-sync.json
```

## Schema v0.2

```json
{
  "schemaVersion": "0.2",
  "app": "chatgpt-sync",
  "mode": "memory-bridge",
  "createdAt": "2026-05-29T00:00:00.000Z",
  "source": {
    "platform": "chatgpt-web",
    "url": "https://chatgpt.com/...",
    "account": {
      "key": "source-account-key",
      "label": "Source account name"
    }
  },
  "project": {
    "title": "Project name",
    "instructions": "Project instructions detected from visible editable UI when available",
    "notes": "User-written notes",
    "detectedFromPage": true
  },
  "chats": [
    {
      "title": "Chat title",
      "url": "https://chatgpt.com/c/..."
    }
  ],
  "messages": [
    {
      "role": "user",
      "text": "Visible rendered message text"
    },
    {
      "role": "assistant",
      "text": "Visible rendered assistant message text"
    }
  ],
  "files": [
    {
      "id": "file_...",
      "name": "asset.png",
      "mimeType": "image/png",
      "sizeBytes": 12345,
      "dataUrl": "optional locally cached image preview",
      "conversationId": "chat-id",
      "sourceDownloadPath": "/backend-api/files/download/file_...?conversation_id=chat-id&inline=false"
    }
  ],
  "capture": {
    "method": "visible-dom",
    "backendConversationId": null,
    "backendProjectId": null,
    "backendApiError": null
  },
  "restore": {
    "steps": [
      {
        "id": "create-project",
        "label": "Create a new ChatGPT Project in the destination account",
        "done": false
      },
      {
        "id": "copy-instructions",
        "label": "Copy project instructions and notes",
        "done": false
      },
      {
        "id": "paste-archive",
        "label": "Paste or upload the captured chat archive",
        "done": false
      },
      {
        "id": "reupload-files",
        "label": "Re-upload project files manually",
        "done": false
      }
    ]
  }
}
```

## Privacy rule

Backups should not include session tokens, cookies, passwords, signed download URLs, or raw private API responses.

When a signed-in ChatGPT tab is open, the extension may call ChatGPT same-origin backend endpoints from that tab to capture the current conversation more completely. This uses the browser's existing session automatically; users should never paste bearer tokens, session cookies, or Cloudflare cookies into the extension. File records store only stable file metadata and an internal same-origin download path that can be used while the original source account session is still available.

## Offline Archive

The extension also keeps a local archive in `chrome.storage.local` so cached chats can be read from `offline.html` without network access.

```json
{
  "schemaVersion": "0.2",
  "app": "chatgpt-sync",
  "mode": "offline-archive",
  "createdAt": "2026-05-29T00:00:00.000Z",
  "lastSyncedAt": "2026-05-29T00:03:00.000Z",
  "accounts": [],
  "projects": [],
  "chats": [],
  "messages": [],
  "files": []
}
```

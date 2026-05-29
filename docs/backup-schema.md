# Backup Schema

ChatGPT Sync backups are plain JSON files. They should be readable, portable, and safe to inspect.

## File extension

Recommended extension:

```txt
.chatgpt-sync.json
```

## Schema v0.1

```json
{
  "schemaVersion": "0.1",
  "app": "chatgpt-sync",
  "createdAt": "2026-05-29T00:00:00.000Z",
  "source": {
    "platform": "chatgpt-web",
    "url": "https://chatgpt.com/...",
    "accountHint": "optional user note"
  },
  "project": {
    "title": "Project name",
    "instructions": "Project instructions copied from the visible UI",
    "notes": "User-written notes",
    "color": null,
    "icon": null
  },
  "chats": [
    {
      "title": "Chat title",
      "url": "https://chatgpt.com/c/...",
      "notes": "Optional user note",
      "contentMarkdown": "Optional user-pasted/exported transcript"
    }
  ],
  "files": [
    {
      "name": "example.pdf",
      "status": "checklist-only",
      "notes": "Re-upload manually during restore"
    }
  ],
  "restore": {
    "steps": [
      {
        "id": "create-project",
        "label": "Create a new ChatGPT Project",
        "done": false
      },
      {
        "id": "copy-instructions",
        "label": "Copy project instructions",
        "done": false
      },
      {
        "id": "upload-files",
        "label": "Re-upload files",
        "done": false
      },
      {
        "id": "attach-chat-archive",
        "label": "Add chat archive as project reference",
        "done": false
      }
    ]
  }
}
```

## Privacy rule

Backups should not include session tokens, cookies, passwords, or hidden internal identifiers.

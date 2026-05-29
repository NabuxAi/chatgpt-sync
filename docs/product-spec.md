# Product Specification

## Product name

ChatGPT Sync

## One-line pitch

Capture ChatGPT Project context into a portable local package and rebuild it safely in another account.

## Primary user problem

Users create valuable work inside ChatGPT Projects, but there is no simple official way to export one Project and import it into another ChatGPT account while preserving the structure.

## Core promise

ChatGPT Sync helps users preserve project context in a portable, readable, local-first backup package before account access is lost, and keeps a local offline archive of previously captured chats.

## Honest limitation

Until OpenAI offers an official Projects export/import API, ChatGPT Sync cannot guarantee true native migration of Projects, internal conversation IDs, hidden system metadata, or full sidebar reconstruction.

## MVP scope

### Export

The extension should capture user-owned data from the active signed-in ChatGPT tab:

- Project title
- Project URL
- Export timestamp
- User-written project instructions when visible/editable
- Visible chat titles/links in the project
- Rendered messages on the current page
- Same-session conversation API messages and file metadata when available
- User notes entered into the extension
- File checklist and same-origin source download paths for manual re-upload while the source session remains available
- Local offline archive in extension storage
- ChatGPT-like offline reader with source-account switching, chat browsing, message reading, and captured attachment previews when locally cached
- Conservative automatic sync for currently open ChatGPT tabs
- Gentle background sync that queues discovered pages and opens one target per delayed step

### Restore

The extension should guide the user to:

- Create a new ChatGPT Project
- Copy project instructions and notes
- Re-upload files manually
- Paste/import readable chat archives as reference material
- Mark restore steps as complete

## Out of scope for MVP

- Reading private session tokens
- Automated account switching
- Bypassing ChatGPT security controls
- Circumventing rate limits, protective measures, or access restrictions
- Claiming official OpenAI integration
- Recreating old chats as native ChatGPT sidebar conversations
- Bulk extraction that continues after ChatGPT returns rate-limit warnings
- Syncing account data that the signed-in browser session cannot access

## Rate-limit posture

ChatGPT does not publish a stable public limit for the private web conversation endpoints. The extension should therefore avoid guessing a high request rate:

- Use the browser's existing session only; never ask users to paste bearer tokens or cookies.
- Open one queued page per background step.
- Wait multiple minutes between queued steps.
- Back off for at least 30 minutes on 429 / Too Many Requests.
- Keep target queues bounded.
- Prefer official OpenAI export/import APIs if they become available.

## Ideal future state

If OpenAI releases an official Projects API, ChatGPT Sync can add:

- Official project export
- Official project import
- File migration
- Conversation migration
- Multi-account restore

## Suggested marketing copy

Backup your ChatGPT Projects. Restore your workflow anywhere.

Not fake folders. Not risky token scraping. A clean, local-first project snapshot system for people who actually work inside ChatGPT.

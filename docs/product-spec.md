# Product Specification

## Product name

ChatGPT Sync

## One-line pitch

Back up your ChatGPT Projects into a portable local file and rebuild them safely in another account.

## Primary user problem

Users create valuable work inside ChatGPT Projects, but there is no simple official way to export one Project and import it into another ChatGPT account while preserving the structure.

## Core promise

ChatGPT Sync helps users preserve project context in a portable, readable, local-first backup package.

## Honest limitation

Until OpenAI offers an official Projects export/import API, ChatGPT Sync cannot guarantee true native migration of Projects, internal conversation IDs, hidden system metadata, or full sidebar reconstruction.

## MVP scope

### Export

The extension should capture data that is visible and user-owned:

- Project title
- Project URL
- Export timestamp
- User-written project instructions when visible/editable
- Visible chat titles/links in the project
- User notes entered into the extension
- File checklist created by the user

### Restore

The extension should guide the user to:

- Create a new ChatGPT Project
- Copy project instructions
- Re-upload files manually
- Paste/import readable chat archives as reference material
- Mark restore steps as complete

## Out of scope for MVP

- Reading private session tokens
- Automated account switching
- Bypassing ChatGPT security controls
- Scraping hidden internal APIs
- Claiming official OpenAI integration
- Recreating old chats as native ChatGPT sidebar conversations

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

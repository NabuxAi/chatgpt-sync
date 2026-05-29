# ChatGPT Sync

**ChatGPT Sync** is a local-first browser extension concept for backing up and rebuilding ChatGPT Projects across accounts.

> Important: ChatGPT does not currently expose a public one-click Projects import/export flow for consumer accounts. This project is designed to stay honest and safe: it creates portable project backups and provides assisted restore workflows without collecting passwords, API keys, session tokens, or cookies.

## Goal

Make ChatGPT Projects portable:

- Back up project name, notes, instructions, visible chat references, and file checklist.
- Export a readable `.chatgpt-sync.json` package.
- Rebuild a project in another account with guided restore steps.
- Keep everything local in the browser by default.

## What this is not

This is **not** a credential harvester and does not ask for:

- ChatGPT password
- Session cookie
- Access token
- OpenAI API key
- Browser profile access

This is also **not** claiming native ChatGPT database migration. A true one-click native restore of Projects would require official OpenAI support or an officially documented API.

## Current MVP

The initial MVP is an assisted backup/restore extension:

1. Open a ChatGPT Project page.
2. Click **Create Snapshot**.
3. The extension saves visible project metadata into a local JSON backup.
4. On another account, load the backup file.
5. Follow the restore checklist to recreate the project safely.

## Roadmap

- [ ] Chrome Extension MV3 scaffold
- [ ] Local project snapshot exporter
- [ ] Backup package schema
- [ ] Assisted restore screen
- [ ] File checklist and manual re-upload flow
- [ ] Optional encrypted local vault
- [ ] Official API support if OpenAI exposes Projects import/export

## Repository structure

```txt
apps/extension/        Chrome extension MVP
docs/                  Product, security, and technical specs
```

## Security principle

If a feature requires stealing or copying private ChatGPT session credentials, it should not be implemented.

## License

TBD

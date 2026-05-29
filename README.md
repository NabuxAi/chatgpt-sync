# ChatGPT Sync

**ChatGPT Sync** is a local-first browser extension concept for capturing and rebuilding visible ChatGPT Projects and chats across accounts.

> Important: ChatGPT does not currently expose a public one-click Projects import/export flow for consumer accounts. This project is designed to stay honest and safe: it creates portable project backups and provides assisted restore workflows without collecting passwords, API keys, session tokens, or cookies.

## Goal

Make ChatGPT Projects portable before account access is lost:

- Scan the current ChatGPT page for project metadata, chat links, rendered messages, and, when available, the same-session conversation API data.
- Save the captured package to temporary browser memory with `chrome.storage.session`.
- Cache captured chats in local browser storage for offline reading.
- Automatically sync open ChatGPT tabs every few minutes.
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

The current MVP is an assisted memory bridge:

1. Open a ChatGPT Project page.
2. Click **Scan Page**.
3. The extension first tries a same-session ChatGPT conversation API capture, then falls back to the rendered page scan.
4. Save the package to browser session memory or download a `.chatgpt-sync.json` backup.
5. Switch to the destination account.
6. Load the browser memory package or JSON backup.
7. Follow the restore checklist to recreate the project safely.

Open **Offline Reader** from the popup to view cached chats without network access. The reader uses a ChatGPT-like layout with a chat sidebar, account switcher for multiple cached source accounts, message bubbles, and attachment cards for captured files or locally cached image previews. The extension also asks Chrome to sync open ChatGPT tabs every 10 minutes while the browser is running.

For larger backups, use **Start Gentle Background Sync**. It queues discovered project/chat pages and opens one page at a time with a multi-minute delay between steps. If ChatGPT returns a 429 / Too Many Requests response, the job backs off for at least 30 minutes before trying again.

## Roadmap

- [x] Chrome Extension MV3 scaffold
- [x] Visible page scanner
- [x] Session memory vault
- [x] Offline local archive
- [x] Static offline reader page
- [x] Automatic open-tab sync
- [x] Same-session conversation API capture for open ChatGPT chats
- [x] JSON backup exporter
- [x] Backup package schema
- [x] Assisted restore screen
- [ ] File checklist and manual re-upload flow
- [ ] Optional encrypted local vault
- [ ] User-configurable sync interval
- [ ] Official API support if OpenAI exposes Projects import/export

## Repository structure

```txt
apps/extension/        Chrome extension MVP
docs/                  Product, security, and technical specs
```

## Security principle

If a feature requires stealing or copying private ChatGPT session credentials, it should not be implemented.

The extension may use the browser's existing ChatGPT session from a signed-in ChatGPT tab, but it must never ask the user to paste bearer tokens, cookies, Cloudflare clearance values, or session strings.

## License

TBD

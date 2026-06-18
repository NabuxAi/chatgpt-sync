# Contributing to ChatGPT Sync

First off — **thank you** for taking the time to contribute! 🎉

ChatGPT Sync is a small, local-first browser extension written in TypeScript.
That makes it a friendly project to jump into: a tiny, dependency-light codebase,
no framework to learn, fast unit tests, and a single-command build. This guide
explains how the project is put together and how to get your first change merged.

If anything here is unclear, open an issue — improving this document is itself a
welcome contribution.

---

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Prerequisites](#prerequisites)
- [Get the code running in 5 minutes](#get-the-code-running-in-5-minutes)
- [Project structure](#project-structure)
- [Architecture overview](#architecture-overview)
- [Message protocol](#message-protocol)
- [Running tests](#running-tests)
- [End-to-end / live runner](#end-to-end--live-runner)
- [Coding standards](#coding-standards)
- [Security principles (please read)](#security-principles-please-read)
- [Commit & pull request guidelines](#commit--pull-request-guidelines)
- [Good first issues](#good-first-issues)

---

## Code of conduct

Be kind, be patient, assume good intent. We want this to be a welcoming place for
first-time open-source contributors and seasoned extension developers alike.
Harassment of any kind is not tolerated.

---

## Ways to contribute

You do not need to write code to be valuable here:

- 🐛 **Report bugs** — open an issue describing what happened, what you expected,
  your browser/version, and steps to reproduce.
- 💡 **Suggest features** — especially ideas that respect the project's
  [security principles](#security-principles-please-read).
- 📖 **Improve docs** — fix typos, clarify wording, translate this guide, or add
  examples. The repo's docs live in [`docs/`](docs/).
- 🎨 **Design** — icons, popup UI polish, offline-reader UX.
- 🧪 **Add tests** — the unit-test suite is fast and easy to extend.
- 💻 **Write code** — pick up a [good first issue](#good-first-issues) or anything
  from the roadmap in the [README](README.md#roadmap).

---

## Prerequisites

- **Node.js 22.18+** — runs the unit tests and helper scripts directly from
  TypeScript via Node's built-in type stripping (no compile step for tests).
- **npm** — installs the dev tooling (the TypeScript compiler and type
  definitions). The shipped extension still has no runtime dependencies.
- A **Chromium-based browser** (Chrome, Brave, Edge) to load the extension. The
  manifest is Manifest V3.
- Git and a GitHub account.

`npm run build` compiles the TypeScript into `apps/extension/dist/`, which is the
folder you load "unpacked".

---

## Get the code running in 5 minutes

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/chatgpt-sync.git
cd chatgpt-sync

# 2. Install the dev tooling
npm install

# 3. Run the tests to confirm everything is green
npm test

# 4. Build the loadable extension into apps/extension/dist/
npm run build
```

### Load the extension in your browser

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the `apps/extension/dist` folder (run `npm run build` first).
5. Pin **ChatGPT Sync** to your toolbar and open it on a `https://chatgpt.com/*`
   tab.

When you change a file, run `npm run build` again, then return to
`chrome://extensions` and click the **reload** (↻) icon on the ChatGPT Sync card
to pick up your edits. Content-script changes also require reloading the ChatGPT tab.

---

## Project structure

```txt
chatgpt-sync/
├── apps/
│   └── extension/              # The Manifest V3 Chrome extension (all runtime code, TypeScript)
│       ├── manifest.json       # MV3 manifest: permissions, background SW, content scripts
│       ├── background.ts       # Service worker: alarms, sync orchestration, message router
│       ├── content.ts          # Injected into ChatGPT pages: DOM + same-session API capture
│       ├── content-script-bridge.ts  # Helper to message the content script (with inject fallback)
│       ├── sync-core.ts        # Pure logic: build packages, merge archive, render offline HTML
│       ├── session-vault.ts    # chrome.storage.session wrapper (the "memory bridge" package)
│       ├── offline-vault.ts    # chrome.storage.local wrapper (the offline archive)
│       ├── deep-sync-planner.ts   # Plans the queue of pages for deep / gentle sync
│       ├── gentle-sync-policy.ts  # Rate-limit constants + 429 detection
│       ├── types.ts            # Shared domain types used across the surfaces
│       ├── popup.{html,ts,css}      # Toolbar popup UI
│       ├── offline.{html,ts,css}    # Static offline reader (ChatGPT-like layout)
│       ├── sync-progress.{html,ts,css}  # Gentle-sync progress page
│       ├── quickstart.{html,ts,css}     # Onboarding page
│       ├── icons/              # Extension icons
│       ├── dist/               # Build output (git-ignored) — load this folder unpacked
│       └── *.test.ts           # Unit tests, colocated next to the module they cover
├── docs/                       # Product spec & backup schema
│   ├── product-spec.md
│   └── backup-schema.md
├── scripts/
│   ├── build-extension.ts          # Compiles TS → dist/ + copies static assets
│   ├── health-check.ts             # Type-check + syntax-check + tests (used by CI)
│   └── live-extension-runner.ts    # Playwright end-to-end smoke test
├── tsconfig.json               # Base TypeScript config (type-checks everything)
├── tsconfig.build.json         # Build config (emits the extension to dist/)
├── package.json                # Dev tooling + scripts (build, typecheck, test, health-check)
└── README.md
```

**Rule of thumb:** business logic that does not touch `chrome.*` APIs belongs in
`sync-core.ts` (or another pure module) so it can be unit-tested directly. Thin
`chrome.*` wrappers (`session-vault.ts`, `offline-vault.ts`) stay small and
delegate to the pure logic.

---

## Architecture overview

ChatGPT Sync has four runtime surfaces that talk to each other through Chrome's
message passing:

```
┌──────────────┐   messages    ┌──────────────────┐   scripting/messages   ┌───────────────┐
│  popup.ts    │ ────────────► │  background.ts   │ ─────────────────────► │  content.ts   │
│ (toolbar UI) │ ◄──────────── │ (service worker) │ ◄───────────────────── │ (ChatGPT tab) │
└──────────────┘               └──────────────────┘                        └───────────────┘
        │                               │
        │ session vault                 │ offline vault + alarms
        ▼                               ▼
 chrome.storage.session         chrome.storage.local
                                        ▲
                                        │ reads cached chats
                                 ┌──────────────┐
                                 │  offline.ts  │  (static offline reader page)
                                 └──────────────┘
```

- **`content.ts`** runs inside the ChatGPT tab. It scans the visible DOM for the
  project title, instructions, chat links, and rendered messages, and — when a
  signed-in session is available — calls ChatGPT's *same-origin* backend
  endpoints to capture the current conversation more completely. It never asks
  for or stores tokens/cookies.
- **`background.ts`** is the brain. It owns the `chrome.alarms` that drive the
  10-minute auto-sync and the gentle background sync, orchestrates deep sync by
  opening queued pages one at a time, and routes all runtime messages.
- **`popup.ts`** is the user-facing control panel: Scan Page, save to session
  memory, export JSON, start gentle sync, open the offline reader.
- **`offline.ts`** renders cached chats from `chrome.storage.local` so they can
  be read with no network access.
- **`sync-core.ts`** is the pure heart: `buildMemoryPackage()`,
  `mergePackageIntoArchive()`, `summarizeArchive()`, and
  `renderOfflineChatHtml()`. Most logic changes should land here with tests.

### Sync modes at a glance

| Mode | Trigger | What it does |
| --- | --- | --- |
| **Scan Page** | Popup button | One-shot capture of the active tab. |
| **Auto sync** | `chrome.alarms`, every `AUTO_SYNC_PERIOD_MINUTES` (10) | Re-syncs currently open ChatGPT tabs. |
| **Gentle / deep sync** | Popup button | Queues discovered project/chat pages and opens **one per step** with a multi-minute delay; backs off ≥30 min on HTTP 429. |

The conservative timing lives in [`gentle-sync-policy.ts`](apps/extension/gentle-sync-policy.ts)
and the queue planning in [`deep-sync-planner.ts`](apps/extension/deep-sync-planner.ts).
Please keep these polite — see the rate-limit posture in the
[product spec](docs/product-spec.md#rate-limit-posture).

---

## Message protocol

All cross-surface communication uses `chrome.runtime` / `chrome.tabs` messages
with a `type` string. When you add a feature, follow this convention and document
the new message here.

| Message type | From → To | Purpose |
| --- | --- | --- |
| `CHATGPT_SYNC_SCAN_PAGE` | background/popup → content | Scan the active ChatGPT page (DOM + same-session API). |
| `CHATGPT_SYNC_CHECK_LOGIN` | background → content | Detect whether the tab is signed in. |
| `CHATGPT_SYNC_SCAN_NOW` | popup → background | Scan the active tab and return a package. |
| `CHATGPT_SYNC_SCAN_AND_SYNC` | popup → background | Scan, then merge into the offline archive. |
| `CHATGPT_SYNC_RUN_AUTO_SYNC` | popup/offline → background | Run an auto-sync pass over open tabs. |
| `CHATGPT_SYNC_RUN_DEEP_SYNC` | popup → background | Start a gentle deep sync from the active tab. |
| `CHATGPT_SYNC_START_GENTLE_SYNC` | popup → background | Begin the gentle background-sync job. |
| `CHATGPT_SYNC_STOP_GENTLE_SYNC` | popup → background | Cancel the gentle-sync job. |
| `CHATGPT_SYNC_GET_GENTLE_SYNC_STATUS` | sync-progress → background | Read current gentle-sync state. |
| `CHATGPT_SYNC_GET_LAST_SCAN_RESULT` | popup → background | Retrieve (and clear) the last scan result. |

Message handlers that respond asynchronously **must `return true`** from the
`onMessage` listener so the channel stays open for `sendResponse`.

---

## Running tests

The unit tests use Node's built-in test runner. Node runs the TypeScript test
files directly via type stripping, so there is no build step before testing.

```bash
npm test            # runs `node --test` across all *.test.ts files
npm run typecheck   # type-checks the whole project with `tsc --noEmit`
```

Tests are colocated with the modules they cover (e.g. `sync-core.test.ts` lives
next to `sync-core.ts`). They `import` the pure modules and assert behaviour with
`node:assert/strict`. `manifest.test.ts` guards the manifest's critical fields.

**Every behaviour change should come with a test.** Because the core logic is
pure, this is usually quick: import the function, feed it sample scan data, assert
on the resulting package or archive. Use the existing tests as templates.

---

## End-to-end / live runner

[`scripts/live-extension-runner.ts`](scripts/live-extension-runner.ts) loads the
real **built** extension (run `npm run build` first) into a Chromium browser via
Playwright, serves fake ChatGPT pages, and exercises scan → auto-sync →
offline-reader end to end, saving screenshots to `tmp/live-extension-test/`.

This is an optional smoke test, not part of `npm test`. It requires Playwright and
currently points at a hard-coded Brave path:

```js
executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
```

To run it locally you will need `npx playwright install` and to adjust that path
for your OS/browser. Making the runner cross-platform (auto-detect the browser) is
a great contribution — see [good first issues](#good-first-issues).

---

## Coding standards

The codebase is intentionally simple. Match the style you see around you:

- **TypeScript, ES modules.** Use `import`/`export` with `.ts` specifiers (e.g.
  `import … from "./sync-core.ts"`); the manifest declares the service worker as
  `"type": "module"`. `tsc` is the only build tool — no bundler, no JSX. Run
  `npm run typecheck` before sending a change.
- **No new runtime dependencies** without discussion. Keeping the shipped
  extension dependency-free is a feature (smaller attack surface, easier review).
  Dev-only tooling (TypeScript, type definitions, Playwright) is fine.
- **2-space indentation**, double quotes, semicolons — consistent with existing
  files.
- **Keep `chrome.*` access in thin wrappers.** Put testable logic in pure modules.
- **Escape untrusted content.** Anything captured from a page and later rendered
  (e.g. in the offline reader) must be escaped — see `escapeHtml` /
  `renderOfflineChatHtml`. Never build DOM from raw captured text.
- **Small, focused functions** with clear names, mirroring the current code.

---

## Security principles (please read)

This is the most important section. ChatGPT Sync is deliberately **honest and
safe**, and contributions must preserve that. From the README:

> If a feature requires stealing or copying private ChatGPT session credentials,
> it should not be implemented.

Concretely, **do not** add code that:

- ❌ asks the user to paste a password, bearer token, session cookie, Cloudflare
  clearance value, or API key;
- ❌ reads, exfiltrates, or stores session tokens/cookies;
- ❌ writes secrets, signed download URLs, or raw private API responses into a
  backup file (see the [backup schema](docs/backup-schema.md#privacy-rule));
- ❌ hammers ChatGPT's endpoints or tries to bypass rate limits / protections —
  respect the [rate-limit posture](docs/product-spec.md#rate-limit-posture).

What **is** allowed: using the browser's *existing* signed-in session from an
open ChatGPT tab to call same-origin endpoints, exactly as the page itself would.

If a change touches capture, storage, or network behaviour, call that out
explicitly in your PR description so reviewers can check it against these rules.

---

## Commit & pull request guidelines

1. **Branch** off `main` with a descriptive name, e.g.
   `feature/configurable-sync-interval` or `fix/offline-reader-escaping`.
2. **Keep PRs focused** — one logical change per PR is much easier to review and
   merge than a large grab-bag.
3. **Write clear commit messages** in the imperative mood:
   `Add user-configurable sync interval`.
4. **Run `npm test`** before pushing and make sure it is green.
5. **Update docs** when behaviour changes — the README roadmap, the
   [backup schema](docs/backup-schema.md), and this guide as needed.
6. **Open a pull request** describing *what* changed and *why*. Link any related
   issue. If your change affects capture/storage/network, confirm it respects the
   [security principles](#security-principles-please-read).

Maintainers will review as soon as they can. Don't be discouraged by review
feedback — it's how we keep the project clean and trustworthy.

---

## Good first issues

Looking for a place to start? These come straight from the
[roadmap](README.md#roadmap) and the notes above:

- ⏱️ **User-configurable sync interval** — currently hard-coded to
  `AUTO_SYNC_PERIOD_MINUTES = 10` in `sync-core.ts`. Add a setting in the popup
  and persist it.
- 📁 **File checklist & manual re-upload flow** — guide users through re-uploading
  captured files during restore.
- 🔒 **Optional encrypted local vault** — encrypt the offline archive at rest.
- 🖥️ **Make the live runner cross-platform** — auto-detect the browser instead of
  the hard-coded Brave path in `scripts/live-extension-runner.ts`.
- 🧪 **Add tests** for any module that feels under-covered.
- 🌍 **Translate the docs** (including this guide) into other languages.

Pick one, comment on the issue (or open one), and have at it. Welcome aboard! 🚀

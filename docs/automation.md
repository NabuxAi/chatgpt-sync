# Repository automation

ChatGPT Sync ships with three GitHub Actions workflows.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | every PR + push to `main` | Runs `npm run health-check` (type-check, lint, syntax, manifest, tests, audit) and `npm run build`. The gate human PRs must pass. |
| [`daily-health-check.yml`](../.github/workflows/daily-health-check.yml) | daily (cron) | Runs the health check and files/closes a single rolling issue when something breaks. |
| [`daily-autofix.yml`](../.github/workflows/daily-autofix.yml) | daily (cron) + manual | The autonomous "self-improvement" bot described below. |

## The daily autofix bot

Once a day, [`daily-autofix.yml`](../.github/workflows/daily-autofix.yml) uses the
[Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions) to:

1. **Pick one small, safe task** from the README roadmap / CONTRIBUTING
   good-first-issues (or a bug/test/docs improvement).
2. **Open a tracking issue** (labelled `automated-improvement`).
3. **Implement it** on an `auto/<date>-<slug>` branch, adding/updating a test
   when behaviour changes.
4. **Open a pull request** that closes the issue.
5. **Validate and merge**: it re-runs `npm run health-check` on the PR branch and
   squash-merges **only if every check passes**. If anything fails, it comments
   on the PR and leaves it open for a human.

### Required setup

The bot does nothing until you complete two one-time steps:

1. **Add the model credential.** In *Settings → Secrets and variables → Actions*,
   add a repository secret named **`ANTHROPIC_API_KEY`** (an Anthropic API key).
   To use a Claude Pro/Max subscription instead, store the token as
   `CLAUDE_CODE_OAUTH_TOKEN` and pass it to the `anthropic_api_key:` input.
2. **Let Actions open PRs.** In *Settings → Actions → General → Workflow
   permissions*, select **Read and write permissions** and tick **Allow GitHub
   Actions to create and approve pull requests**.

### Safety model

- **Hard merge gate.** The merge step re-runs `npm run health-check` itself and
  merges only on success — this gate does not depend on the model behaving.
- **Scoped changes.** The prompt restricts the bot to one small change per day,
  forbids touching the workflows, weakening the manifest's permissions, or
  deleting tests, and enforces the project's security principles (never handle
  credentials/cookies/tokens).
- **Reversible.** Everything lands as a squash commit you can revert, and each
  change is tracked by an issue + PR.

### Tuning it

- **Pause it:** disable the workflow in the *Actions* tab, or delete the file.
- **Require human review instead of auto-merge:** delete the final
  *"Validate and auto-merge the bot's PR"* step. The bot will then only open
  issues and PRs for you to review and merge.
- **Change cadence / model:** edit the `cron:` schedule and the
  `--model` / `--max-turns` values in `claude_args`.
- **Steer a specific task:** run the workflow manually (*Actions → Daily autofix
  → Run workflow*) and fill in the optional **task** input.

### Note on CI for bot PRs

PRs opened with the built-in `GITHUB_TOKEN` do not trigger other workflows
(`ci.yml` won't run on them — this is a GitHub safeguard against recursive
runs). That is why `daily-autofix.yml` runs the health check itself before
merging. `ci.yml` still validates all human-authored PRs.

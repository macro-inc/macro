# crates/integrations

## What it is

Integrations with outside tools: GitHub (the app, pull requests, patches), inbound webhooks and their signatures, the Notion, Linear and Jira importers with their tracker, Granola sync, and link unfurling.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`git_patch`](git_patch/AGENTS.md) | Shared infrastructure for the agent sessions and GitHub integration features: parses git-style unified diffs into per-file facts, cuts them to a size budget, and builds … |
| [`github`](github/AGENTS.md) | Backs the GitHub integration used by agent sessions and document storage: GitHub account linking, the GitHub App install/webhook sync, and the OAuth link flow, following … |
| [`github_pull_requests`](github_pull_requests/AGENTS.md) | Backs the GitHub integration's pull request surface (agent session changesets and PR review): the PR model, stored as `foreign_entity` records, the rules for merging … |
| [`granola_sync`](granola_sync/AGENTS.md) | Imports Granola meeting notes as private Macro calls. |
| [`import`](import/AGENTS.md) | Belongs to AI chat and Settings: the import pipeline tracking external items (Linear and Jira issues, Notion pages, Slack channels) as they're discovered, accepted, and … |
| [`import_jira`](import_jira/AGENTS.md) | Read-only Jira Cloud workspace inventory. |
| [`import_linear`](import_linear/AGENTS.md) | Read-only Linear workspace inventory. |
| [`import_notion`](import_notion/AGENTS.md) | Part of the Notion import feature. |
| [`import_tracker`](import_tracker/AGENTS.md) | Shared read-only issue tracker contracts and Pipedream transport. |
| [`unfurl`](unfurl/AGENTS.md) | Shared infrastructure for link previews, used by email and CRM — a hex crate for URL unfurling: fetches a URL's meta tags (title, description, image, favicon) with SSRF … |
| [`webhook`](webhook/AGENTS.md) | Part of the integrations feature — lets external systems subscribe to Macro events. |
| `webhook_signature` |  |

## Recipes

- Add a crate here: create `crates/integrations/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.

# connectors_e2e

## What it is

The end-to-end suite for integrations (`crates/connectors`): Macro on dev,
driven through its public HTTP API (`/connectors`, a Notion import) and an
agent session, as two test accounts, against the real Pipedream, Macro
Connect, a native MCP server and the GitHub account link. `src/` is the
harness; `tests/connectors.rs` holds the scenarios.

## How it works

- Each source gets the same checks: listed with its status, connect where
  consent is already given (`complete`), the connect step, an agent loads the
  app's tools and calls one, disable and enable. The API check imports a
  Notion page (Notion's API through the connection). A URL server is added
  and removed by the suite itself.
- An agent check opens a session of the default agent whose prompt asks it to
  use one app and end with a `CONNECTORS-E2E <nonce> tools=… called=… ok=…`
  line, reads the folded log until the turn ends, and archives the session.
- Removing a Connect, Pipedream or GitHub connection revokes it at the vendor,
  so `removing_a_hosted_connection_disconnects_it` is `#[ignore]`d: run it by
  hand (`just connectors-e2e --run-ignored only`), then reconnect in Settings.

## Settings

Without both API keys every scenario prints `SKIP` and passes; a scenario
whose fixture is unset skips the same way. CI passes the keys and the alert
token as repository secrets and the rest as repository variables
(`.github/workflows/connectors_e2e.yml`).

| Name | Kind | What |
| --- | --- | --- |
| `CONNECTORS_E2E_FLAGGED_API_KEY` | secret | User API key (`mak_…`) of the `@macro.com` account, on `macro-connect` |
| `CONNECTORS_E2E_UNFLAGGED_API_KEY` | secret | User API key of the account off the rollout |
| `CONNECTORS_E2E_CONNECT_APP` | variable | App slug the flagged account connected through Connect |
| `CONNECTORS_E2E_PIPEDREAM_APP` | variable | App slug the unflagged account connected through Pipedream |
| `CONNECTORS_E2E_GITHUB_LINKED` | variable | Non-empty when the unflagged account linked GitHub |
| `CONNECTORS_E2E_MCP_SERVER_URL` | variable | A real MCP server that needs no sign-in |
| `CONNECTORS_E2E_NOTION_PAGE` | variable | A Notion page the account holding Notion can read |
| `CONNECTORS_E2E_ALERT_WEBHOOK_URL` | variable | Webhook of the Macro channel failures go to |
| `CONNECTORS_E2E_ALERT_BOT_TOKEN` | secret | Bot token that webhook takes |

## Checks

- `cargo nextest run -p connectors_e2e` (unit tests; the default profile
  leaves the scenarios out)
- `just connectors-e2e` with the settings exported, against dev
- CI: `gh workflow run connectors_e2e.yml --ref <branch>`; nightly at 05:00 UTC

## Gotchas

- The scenarios share two real accounts, so the `connectors-e2e` nextest
  profile runs one at a time; never run them in the default profile.
- Never put keys, emails or user ids in code or commits: they come from the
  settings above.
- A scenario restores what it changed (re-enables, removes the server it
  added) even when it fails, so the next run starts clean.

## Related

- Rules: `rules/ast-grep/rust-macro-connect-flag-in-policy.yml`,
  `rules/ast-grep/ts-connection-state-through-connectors-queries.yml`
- Docs: `docs/development/ci.md` (alerts)

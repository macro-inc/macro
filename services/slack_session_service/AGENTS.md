# slack_session_service

## What it is

Slack linked sessions (`docs/architecture/slack-linked.md`): the only process
that talks to Slack. It runs sign-ins DSS records and one websocket per Slack
account it holds the advisory lock for, syncs added Slack Connect chats
through `slack_linked`'s `SessionService`, and dispatches the sends and read
marks DSS records. No HTTP API besides `GET /health`; DSS talks to it only
through rows and `NOTIFY`.

## How it works

- `src/replica.rs`: `replica::start(ReplicaDeps, shutdown)` composes a
  replica; `main.rs` and `crates/slack_e2e` both use it.
- `crates/session_fleet` runs the accounts: lock key
  `hashtextextended('slack-account:' || id, 0)`, rescans, `NOTIFY`
  (`outbound/signals.rs` maps `slack_*` channels), batched drain.
- `domain/account.rs`: one account. `begin_lease` bumps `lease_epoch`;
  `Fenced` stops it. Opens the sealed credentials (KMS refusal →
  `logged_out`/`unreadable`; an outage → `Failed`, retried), `auth.test` +
  `client.userBoot`, Slack Connect catalogue, catch-up from each chat's
  `latest_ts`, websocket events → `slack_inbound` → ingest, history import,
  sends (`begin_dispatch` before `chat.postMessage`; no answer → `unknown`,
  never resent), read marks. A session-ended error (`invalid_auth`,
  `token_revoked`, …) logs the account out; DSS notifies the owner. A
  disconnected account with `sign_out_requested` is signed out, then wiped.
- `domain/login.rs`: sign-in steps (`slack_login_requested`, plus a sweep).
  The step's private state (Slack's cookie jar, magic codes, chosen teams) is
  sealed per attempt (`slack-login`); pasted sessions arrive sealed by DSS
  (`slack-login-input`). Credentials are checked with `auth.test` and sealed
  for their account (`slack-session`) before they are stored.
- `outbound/slack.rs`: `slack_client` adapter; `outbound/secrets.rs`: KMS.

## Config (Doppler `slack-session-service`, `dev` and `prd`)

- `DATABASE_URL` (`${global_databases.<config>.DATABASE_URL}`), the only key;
  it must reach the RDS instance endpoint, never RDS Proxy (advisory locks
  and `LISTEN`).
- KMS key `alias/slack-session-service-<environment>` from `ENVIRONMENT`
  (`slack_linked::outbound::kms::SlackKmsKey`); `xtask_local` creates the
  `-local` alias in LocalStack.
- Tests only, process env: `OVERRIDE_SLACK_BASE_URL` and
  `OVERRIDE_SLACK_WEBSOCKET_URL` (both, or neither) point at a fake Slack.

## Telemetry

Spans: `session_fleet.*` (`fleet = slack`), `slack.account.{connect,signal}`,
`slack.inbound.event`, `slack.catalogue.refresh`, `slack.catch_up`,
`slack.history.page`, `slack.send.dispatch` (joins the recording request's
trace), `slack.login.step`, `slack.signal.receive`, and `slack_client`'s
`slack.api`. Log events: `telemetry_event` = `slack_session_health`,
`slack_session_drain`, `slack_send_outcome`. Opaque ids only; never tokens,
cookies, emails or message text.

## Checks

- `cargo test -p slack_session_service`; `cargo test -p slack_e2e` for the
  fleet (`SQLX_OFFLINE` unset).

## Gotchas

- Unlock before announcing a release (`session_fleet`).
- Never log `SessionCredentials`, `LoginState` or websocket URLs.
- Inbound files and files sent from Macro are not imported yet.

## Related

- `crates/slack_linked/AGENTS.md`, `crates/slack_client/AGENTS.md`,
  `crates/session_fleet/AGENTS.md`, `infra/stacks/slack-session-service/`

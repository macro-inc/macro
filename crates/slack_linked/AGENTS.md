# slack_linked

## What it is

The Slack provider of external chats (`crates/external_chat`): a person's
own Slack web sessions (one account per workspace), sign-in, the Slack
Connect catalogue, adding conversations as their own `ExternalChat`, ingest
and deliberate sends. DSS serves `/slack-linked/*` and composes
`SlackProvider` into `ChatProviders`; `services/slack_session_service` calls
`domain::session::SessionService` in-process and is the only process that
talks to Slack. Design: `docs/architecture/slack-linked.md`.

## Start here

- `src/domain/models.rs`: the `/slack-linked` DTOs (sign-in steps, accounts,
  catalogue). `src/domain/service.rs`: DSS use cases.
  `src/domain/provider.rs`: `ChatProvider` for Slack.
- `src/domain/session.rs` + `events.rs`: the session-service API and the
  mapping from `slack_client` messages and websocket events to stored
  changes.
- `src/outbound/pg/ingest.rs`: one row per `(chat, person, ts)`; senders
  resolve by Slack user id (`slack_user_alias`); thread replies point at
  their root through `reply_to`.
- `src/outbound/pg/logins.rs`: sign-in attempts DSS records and a replica
  claims. `src/outbound/kms.rs`: sealing per purpose with `kms_envelope`.
- Migrations: `crates/macro_db_client/migrations/*_slack_linked.sql`.

## Boundaries

- Depends on: `external_chat`, `slack_client` (models and ids only in the
  domain), `kms_envelope`, entity registry/access/share-permission utils.
- Used by: DSS, `services/slack_session_service`, `crates/slack_e2e`.

## Checks

- `cargo test -p slack_linked --all-features` with `SQLX_OFFLINE` unset and
  `DATABASE_URL` on a migrated MacroDB.

## Gotchas

- DSS never calls Slack and never decrypts: it may only `GenerateDataKey`
  for `slack-login-input`. Secrets are sealed for a scope id (account or
  attempt); a credential sealed for another id never opens.
- A person has several accounts; `SlackProvider::account` returns the oldest
  active one and per-chat facts use any of their accounts observing the chat.
- Every session-service write takes the account row at the caller's
  `lease_epoch`; `Fenced` means stop the account.
- Messages store Slack's raw mrkdwn; the web renders it.
- Inbound files: `outbound/pg/media.rs` reserves one attachment per file
  (locator = Slack file id; the hash is of what arrives). Files sent from
  Macro are not supported yet.

## Related

- Docs: `docs/architecture/slack-linked.md`, `docs/architecture/external-chats.md`

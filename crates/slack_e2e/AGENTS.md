# slack_e2e

## What it is

End-to-end tests of Slack Connect sync: a real `slack_session_service`
replica (supervisor, advisory locks, account runner, `slack_client`) against
`slack_fake_server`, and DSS's use cases (`SlackService`,
`ExternalChatService` with `SlackProvider`) in-process, on one
`#[sqlx::test]` database. Nothing talks to Slack or AWS (a shared `FakeKms`
seals for both sides).

## How it works

- `Replica::start` runs one replica on its own runtime with `TIMINGS`;
  dropping it is process death.
- `watch_tables` adds statement triggers that `NOTIFY e2e_changed`;
  `wait_for_rows` re-checks after each notification instead of polling.
- `src/test.rs`: sign in with a pasted session, add a Slack Connect channel,
  inbound message, thread reply, edit, reaction and delete, a thread reply
  sent from Macro, read marks both ways, session revoked → `logged_out`.

## Checks

- `cargo test -p slack_e2e` with `SQLX_OFFLINE` unset and `DATABASE_URL` on a
  migrated MacroDB; one run per Postgres server at a time.

## Related

- `crates/slack_fake_server/AGENTS.md`, `services/slack_session_service/AGENTS.md`,
  `crates/slack_linked/AGENTS.md`

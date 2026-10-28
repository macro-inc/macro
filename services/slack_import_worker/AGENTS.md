# slack_import_worker

## What it is

Onboards new Channels (chat) customers from Slack: a composition root for
importing Slack archive exports. Writes conversations, messages, and
references into Macro as channels, and sends one best-effort colleague-join
email.

## Start here

- `src/composition.rs`: cross-domain transaction coordination — this is the
  one place that is allowed to coordinate `import` and `slack_integration`
  domain crates together; don't add that coordination to either crate's own
  adapter.
- `src/composition/channel_sink.rs`: writes imported conversations as channels.
- `src/composition/reference_reconciliation.rs` + `src/composition/references.rs`:
  resolving cross-message references (replies, mentions) after import.
- `src/composition/authorizer.rs`, `src/composition/join_announcer.rs`: access
  checks and the join-email side effect.
- `tests/archive_import.rs` + `tests/archive_import/`: end-to-end import tests,
  including kill/recovery behavior (`process_recovery.rs`, `kill_boundaries.sql`).

## Scope

- Owns: turning a parsed Slack archive into Macro channels/messages and
  reconciling references, as a durable, resumable process.
- Not here: parsing the Slack export format or the import job ledger →
  `crates/import`; Slack API/domain types → `crates/slack_integration`.

## Checks

- `cargo test -p slack_import_worker` (`SQLX_OFFLINE` unset).

## Gotchas

- `tests/archive_import/process_recovery.rs` exercises killing the process
  mid-import; `kill_boundaries.sql` encodes the exact points it resumes from —
  a new write step likely needs a new boundary there.

## Related

- Rules: `.agents/rules/rust/architecture.md`

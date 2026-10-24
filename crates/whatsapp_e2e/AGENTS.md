# whatsapp_e2e

## What it is

End-to-end tests for WhatsApp linked devices. Real session-service replicas
(supervisor, advisory locks, account runners, whatsmeow clients, the encrypted
Postgres device store) run against `whatsapp_fake_server`. The DSS side runs
through `whatsapp_linked::LinkedService`, and both share one `#[sqlx::test]`
database. Nothing talks to WhatsApp or AWS (the KMS is
`whatsapp_store_pg`'s `FakeWhatsAppKms`).

## How it works

- `Replica::start` runs one replica on its own Tokio runtime, built by the
  service's `replica::run` with `test_signal()`, the fake server's dialer, a
  shared fake KMS and short timings. `kill()` drops the runtime: sockets, lock
  connection and client die at once, like a crashed process. `drain()` is
  SIGTERM.
- `watch_tables` adds statement triggers that `NOTIFY e2e_changed` on the
  standalone group and linked-account tables; `wait_for_rows` re-checks after each notification
  instead of polling.
- Scenarios (`src/test.rs`): pair by QR through DSS, adopt, inbound once with
  two observing accounts, send from your own number, kill takeover without
  loss or duplicates, drain handover, crash between enqueue and ingest, inbound
  image download for import, outbound attachment, a send cut off after
  submission is `unknown` and never resent, a send without an ack times out as
  `unknown`, a real client's group events through the service's mapping, and
  WhatsApp renames and removals reaching Macro live (a rename WhatsApp made
  is a system line without an actor).
- Message types (`src/test/message_types.rs`): media dimensions, durations
  and presentation (sticker, GIF, voice note), a media reply keeping its
  quote, view-once media imported and downloaded like any media; mentions and
  forwards, polls with a vote and a changed vote, places, contact cards,
  events, pins and call logs as structured content; a mention sent from
  Macro; group changes made by a member (added, left, renamed) as system
  lines once with two observing accounts, never unread or notified.
- Group kinds (`src/test/group_kinds.rs`): a disappearing group is added, an
  ephemeral-wrapped phone message is kept, Macro's sends carry the timer
  until it is turned off live; a community's group and announcement group
  are added and used, the community itself is refused.
- Direct chats (`src/test/direct_chats.rs`): a direct chat from the chat
  list is added, its earlier messages imported from the phone, messages by
  LID and by phone number and from the owner's phone land in it, Macro sends
  to it, and a shared viewer reads but can't send.

## Checks

- `cargo test -p whatsapp_e2e` with `SQLX_OFFLINE` unset and `DATABASE_URL`
  pointing at a migrated MacroDB (the query macros check against it; each test
  gets its own database on that server). If the shared `macrodb` is stale,
  create and migrate your own `macrodb_<name>` with
  `sqlx migrate run --source crates/macro_db_client/migrations`.

## Gotchas

- sqlx derives test database names from test paths: two concurrent runs of
  this crate against one Postgres server collide (`database ... already
  exists`). Run one at a time per server.
- Fleet transport tests inject a permissive `SendRateLimiter`; DSS request throttling is tested at the domain and Redis-adapter boundaries separately.
- The change triggers live in `src/watch_tables.sql`; add a table there when a
  test waits on it.
- A failed ingest wait prints the `whatsapp_inbound_event` and
  `whatsapp_group_message` rows; start debugging there.
- Fake phones send each group message as a real phone does: a sender key
  distribution message in a per-device `pkmsg`, plus the `skmsg`, under one
  message ID. The service must ignore the key-only part.

## Related

- `crates/whatsapp_fake_server/AGENTS.md`, `services/whatsapp_session_service/AGENTS.md`,
  `crates/whatsapp_linked/AGENTS.md`

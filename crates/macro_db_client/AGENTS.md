# macro_db_client

## What it is

Belongs to shared infrastructure: the database client crate for MacroDB
(Postgres), owning its migrations and most of the compile-time-checked
queries used across Rust services.

## Start here

- `src/lib.rs`: the module list — one module per table/feature area
  (`user.rs`, `document.rs`, `organization.rs`, `team/`, `item_access/`, ...).
- `migrations/`: MacroDB's SQLx-generated migrations, 500+
  files; the only place MacroDB schema changes are made.
- `tests/`: cross-table integration tests (e.g. `add_forms.rs`).

## Scope

- Owns: MacroDB's schema (`migrations/`) and the `sqlx::query!` call sites for
  the tables listed in `src/lib.rs`.
- Not here: domain logic, authorization decisions, or caching built on top of
  these queries — those live in the owning domain crate/service that calls in.

`agent_session_notification` is an additive leased outbox owned by
`agent_session`. Review adapters use its transaction-aware producer port;
notification frames have their own log direction. Session deletion cascades
outbox rows, and migrations retain compatibility with prior table writers.

The agent-session notification migration backfills legacy review outcomes and
bridges old-producer writes during rollout; keep that bridge until legacy
review producers have retired. Encode empty legacy item lists as JSON arrays so
the typed notification reader can decode them.

## Boundaries

- Depends on: `entity_access_db_utils`, `entity_registry_db_utils`,
  `models_permissions`, `models_entity_access_management`, `model`, `model-entity`.
- Used by: most Rust services and several domain crates (e.g. `documents`,
  `ai_tools`, `authentication_service`, `email_service`); a query here is
  widely shared — check callers before changing a function's signature.

## Recipes

- Add a column or table: `sqlx migrate add --source crates/macro_db_client/migrations <name>`
  → edit the generated SQL file(s) → the module in `src/<area>.rs`
  (or `src/<area>/`) → `nix develop --command just prepare_db`.
- Add a query to an existing table: the module in `src/<area>.rs` → its tests
  → `nix develop --command just prepare_db` if cache metadata is missing.
- Add a new owned area: `src/<area>.rs` → `pub mod <area>;` in `src/lib.rs` →
  gate it behind a Cargo feature in `Cargo.toml` only if it's optional (see
  `account_merge_request`, `team`).

## Checks

- `cargo test -p macro_db_client` (`SQLX_OFFLINE` unset; requires local MacroDB
  — `just setup_macrodb`).
- After schema or query changes: `nix develop --command just prepare_db` from
  the repo root, then commit the regenerated root `.sqlx/`.

`agent_external_replies` stores external runtime reply destinations and outcomes;
its queries and recovery policy belong to `agent_harness`. Its creation time is
stable across retries, and `announced` records successful pending-message posts.
The additive migrations are compatible with older service binaries; session
deletion cascades its rows.

`agent_preview_*` stores preview-specific ownership, credential hashes and
watchers; its queries and policy belong to `agent_preview`. Leases have a bounded
TTL, deletion cascades credentials, and sweepers reclaim expired watchers and
unreferenced replicas. These additive tables do not change agent-session claims.

## Gotchas

- `calendar_event_notes` and `calendar_note_event_visible` are shared by calendar
  note reads and document authorization; keep both consumers on the same policy.
  The additive migration must precede their service rollout. See
  [meeting-note access](../../docs/architecture/calendar-meeting-notes.md).
- Migrations deploy before service code: never drop a column/table in the
  same PR that removes its last usage (see `docs/development/database.md`).
- Never hand-edit `.sqlx/query-*.json` or invent a migration timestamp.
- Keep concurrent index migrations to one statement with `-- no-transaction`;
  build replacement indexes before dropping old constraints, and validate large
  table checks in a later transaction. See the Outlook rollout notes in
  `docs/design/outlook-email-support.md` for failure recovery and deployment order.
- Quote and alias camelCase columns to Rust field names
  (`SELECT "userId" AS user_id`); don't guess spelling — check `migrations/`.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md` ·
  Docs: `docs/development/database.md` · Skill: `dump-schema`

Email send migrations add `email_messages.draft_generation` and attempt handle/inbox
fences. Deploy the additive migrations and all generation-aware writers before
enabling the independent email outbox; old writers do not enforce these fences.

`preserve_deleted_email_send_delivery` defers active-send deletion before compacting
content. Bypass retention for inboxes marked `deleting_at` and direct inbox
cascades; other parent cascades must not destroy unresolved delivery state. Deferred markers retain provider identity and
draft generation so Undo/resend cannot inherit an old deletion.

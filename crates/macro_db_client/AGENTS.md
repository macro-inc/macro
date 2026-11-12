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

`activity_events.agent_verb` is nullable so older writers and historical rows remain valid during a rolling deploy.

`agent_session_notification` is an additive leased outbox owned by
`agent_session`. Review adapters use its transaction-aware producer port;
notification frames have their own log direction. Session deletion cascades
outbox rows, and migrations retain compatibility with prior table writers.

The agent-session notification migration backfills legacy review outcomes and
bridges old-producer writes during rollout; keep that bridge until legacy
review producers have retired. Encode empty legacy item lists as JSON arrays so
the typed notification reader can decode them.

The `agent_session.turn_state` constraint includes `failed` for terminal turn
errors; extend it additively before services begin writing new turn states.
Install widened checks as `NOT VALID` and validate in a separate migration so
the scan does not retain the replacement migration's exclusive table lock.

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

- Composed-memory tables and refresh leases are owned by `crates/memory`; migrations leave legacy memory rows intact.

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

- `user::get_user_name::get_user_names_with_email` is shared by authentication and bounded contact-directory enrichment; preserve viewer-only address-book fallback and keep its IDs/names off tracing spans.
- `contacts_connections` keeps its raw forward/reverse paging indexes; upstream migration `20261101055556` owns `idx_contacts_connections_user2_user1`, so do not add a duplicate branch migration. Migrations `20261105044718` and `20261105044750` add `(raw viewer, lower(peer COLLATE "C"))` point-lookup indexes with a strict peer `macro|` prefix predicate. They preserve stored rows, edge constraints and cursor order; bounded directory reads belong to `crates/contacts`. Apply both before new readers, with a short session `lock_timeout` (for SQLx CLI, e.g. `PGOPTIONS='-c lock_timeout=5s'`). An interrupted concurrent build must be inspected/repaired before retrying; these migrations do not hide an existing invalid index with `IF NOT EXISTS`.

- Migrations deploy before service code: never drop a column/table in the
  same PR that removes its last usage (see `docs/development/database.md`).
- `call_participants.client` defaults to `person` for older call writers;
  programmatic joins set `agent` or `api_key` after recording attendance.
- Never hand-edit `.sqlx/query-*.json` or invent a migration timestamp.
- Keep concurrent index migrations to one statement with `-- no-transaction`;
  build replacement indexes before dropping old constraints, and validate large
  table checks in a later transaction. See the Outlook rollout notes in
  `docs/design/outlook-email-support.md` for failure recovery and deployment order.
- Quote and alias camelCase columns to Rust field names
  (`SELECT "userId" AS user_id`); don't guess spelling — check `migrations/`.
- Saved-view sharing uses current team membership and chronological owner/team indexes.
  Deploy additive revision and team-share columns before service changes. Keep permanent
  `saved_view_tombstone` IDs and the deletion trigger to prevent delayed creates
  from resurrecting deleted definitions. Use a fresh disposable database when
  checking replacement branch migrations. `saved_view_position` holds each
  viewer's personal order and cascades with both the view and the user.

- External chats (`external_chat*` tables: chats, people, messages, attachments, reactions, poll votes, read state) are provider-neutral; WhatsApp keeps its account, pairing, roster, chat list, membership, alias, observation, receipt and send tables (`whatsapp_*`). Domain queries live in `external_chat` (generic tables) and `whatsapp_linked` (`whatsapp_*` tables and ingest).

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

The import ledger accepts Jira Cloud sources with `jira_issue`, `jira_project`
and `jira_epic` kinds. Jira has its own concurrent partial team-claim index; source
and kind constraints expand without rewriting existing rows and validate separately.

`crm_pipeline_stage_requirements` stores pipeline-owned rules keyed by stage
column, option and required column IDs. Foreign-key cascades remove rules when
any referenced stage, field or pipeline is explicitly deleted; renames preserve them.

`mcp_oauth_*` tables hold the public MCP OAuth broker's state (registrations,
refresh token bindings, pending authorizations, issued codes); their queries and
expiry sweep belong to `mcp_auth_proxy`. Rows carry `expires_at` and have no
foreign keys; the broker deletes expired rows.

- Spam/Trash candidate indexes cover `email_messages(link_id, id)` only for the corresponding positive `mailbox_state` JSON containment predicate; keep query literals aligned with the partial-index predicates.
- If either concurrent folder-index migration is interrupted, inspect `pg_index.indisvalid` and drop only its invalid index before retrying; `CREATE INDEX IF NOT EXISTS` would silently preserve an unusable index.

- `agent_correlation` owns invocation mappings; activity and scheduled-email correlation columns remain nullable for older writers. Build the activity correlation index concurrently, outside a transaction.

`password_item_entities`, `password_folders`, `password_activity`,
`password_write_intents`, `password_totp_enrollments`, `password_team_lifecycle`,
`password_totp_cleanup_candidates`, and `password_totp_cleanup_cursor` belong to
`passwords`. They store team-owned metadata, grants, audit correlation and retry
journals only; credential values and TOTP seeds remain in OpenBao. Preserve the
immutable creator, completed intents, deletion fences and retired enrollment
identities. Membership or account removal ends access without erasing team data.
Retain the team closure fence independently of metadata cascades; purge metadata
only after provider namespace erasure. Keep orphan-discovery candidates durable
with their cursor advance, and separate retry scheduling from TOTP quarantine.

- `activity_events.agent_session_id` is filled only by the `activity_events_agent_session_id` insert trigger from `agent_correlations`; keep it when changing that table or the activity insert.

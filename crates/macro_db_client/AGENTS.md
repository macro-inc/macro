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

Entity appearance is nullable JSON on each owning entity table (including routine
template snapshots and saved-view definitions); appearance-only writes preserve content timestamps. Document
lists and content save responses retain the stored appearance alongside ordinary metadata.

`password_item_favorites` stores private human preferences. Its composite item
and membership foreign keys cascade on deletion. Item triggers seed the creator's
initial flag and clear soft-deleted items; never reseed on metadata updates.
The legacy JSON favorite bit stays for rollback but is no longer a read source;
remove it in a later migration after rollback compatibility is retired.

`contact_list_members` and `contact_inbox_members` (migration `20261120222032`)
are the directed, list-aware contact directory owned by `crates/contacts`; they
replace `contacts_connections`, which stays until its readers are gone. Both store
only canonical lowercase `macro|` ids in `COLLATE "C"` keys. Inbox rows cascade
with their `email_links` row; `user_id` and `list_key` on them repeat the link's
owner and provider on purpose, so reads never join `email_links`. List rows have no
foreign key: the contacts worker removes them on account deletion.

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

Task-template rows cascade with personal users or teams; nullable creator attribution clears on account deletion while team-owned content remains.

`password_import_activity` stores only per-batch source format and counts; its
team foreign key cascades, and the passwords repository includes it in retained
data checks and explicit vault purge. It does not depend on a successful item.

`import_run.personal_root_folder_id` and `personal_folder_ids` are nullable,
additive state owned by the import repository. Preserve both when a later run
restarts, just like `root_folder_id`; they identify the user's persistent
owner-only Notion mirror. No existing folders or import rows are backfilled.

## Gotchas

- `document_email` has a statement-level `AFTER DELETE` trigger
  (`document_email_release`, migration `20261116200143`) that queues each
  document a statement unlinks in `released_email_attachment_documents`, even
  one still linked elsewhere or already in the Trash, and notifies
  `email_attachment_documents_released`;
  document storage drains it. A document already queued is updated, not
  skipped, so its row stays locked until the deleting transaction commits. It
  fires once per outer statement, cascades included. Write a moved link before
  deleting the old one. `tests/released_email_attachment_documents.rs` covers it.
- `crm_email_rule_*` and `crm_email_policy_audit` hold private member/mailbox
  policy history. Selected consent uses its own grant bit and exact revision FK;
  legacy-write/version triggers and mailbox revocation must survive rollbacks.
  The eligibility function migration rejects preexisting selected rows because
  old inline readers remain during deployment. Keep selected activation absent
  until the scalar function, ingestion and Team reader are compatible.
  Keep applied migration files immutable and add forward corrections instead.

- `crm_email_consent.consent_incarnation` is nullable for legacy writers;
  server UUIDv7 initialization preserves existing consent, and an initialized
  identity cannot be cleared or changed. New policy envelopes carry both that
  identity and `policy_version`; null outbox generation fields mean legacy work.
  Keep mailbox/membership cascades and the bounded source-event reverse indexes
  on rule tables. Interrupted concurrent builds of `crm_email_rule_contacts_source`
  or `crm_email_rule_companies_source` require inspecting and dropping only the
  invalid index before retrying the unapplied migration. Modern work also keeps
  an address cursor and sent/received pass; old thread-cursor columns remain for
  rolling compatibility. `crm_email_backfill_outbox_due` orders durable recovery
  signals by `(requested_at, team_id, user_id)`; it adds no email-table index.

- `user::get_user_name::get_user_names_with_email` is shared by authentication and bounded contact-directory enrichment; preserve viewer-only address-book fallback and keep its IDs/names off tracing spans. Its SQL (`user/get_user_name/names_with_email.sql`) reads the viewer's mailboxes once, into an array, and probes `email_contacts` by `(link_id, email_address)`. Don't join `email_links` per requested id again: with statistics that say most mailboxes are the viewer's, that plan searches every mailbox's contacts through the trigram index, seconds for one page of ids. `address_book_names_are_read_through_the_viewers_mailboxes` covers it.
- `contacts_connections` keeps its raw forward/reverse paging indexes; upstream migration `20261101055556` owns `idx_contacts_connections_user2_user1`, so do not add a duplicate branch migration. Migrations `20261105044718` and `20261105044750` add `(raw viewer, lower(peer COLLATE "C"))` point-lookup indexes with a strict peer `macro|` prefix predicate. They preserve stored rows, edge constraints and cursor order; bounded directory reads belong to `crates/contacts`. Apply both before new readers, with a short session `lock_timeout` (for SQLx CLI, e.g. `PGOPTIONS='-c lock_timeout=5s'`). An interrupted concurrent build must be inspected/repaired before retrying; these migrations do not hide an existing invalid index with `IF NOT EXISTS`.

- `item_access::get_accessible_items::get_user_accessible_items` (cached 10 s)
  and `call_record::get::get_accessible_call_ids` (uncached) share one run of
  their queries between concurrent identical callers through `single_flight`.
  The accessible-items run uses `run_to_completion`: it finishes when every
  caller has gone away (a cancelled search), so its document checks are kept
  for the next search, and a caller arriving meanwhile joins it.
  The unit tests compile with the cache off; `tests/coalesced_access_lookups.rs`
  covers the cached path and needs its own user ids per test.
- `get_user_accessible_items` reads the caller's document grants first, up to
  `DOCUMENT_GRANTS_LOOKED_UP_BY_ID`. At or under it, `documents_by_id.sql`
  looks each granted document up by id behind an `OFFSET 0` fence; above it the
  planner chooses. Left alone, the planner scans every live document for a
  caller with many small sources, because it estimates each at the table's
  average grant count. Keep the fence, and re-measure both paths on a
  production-size seed before changing the limit.
- Each of those lookups costs a random read per granted document whose pages
  are not cached, and for callers holding thousands of grants they are cold
  again minutes after their last search. So `checked_documents` keeps, per
  process and caller, what the lookups found about each granted document (it
  exists, and whether the caller owns it) for `CHECKS_KEPT_FOR`, and reads
  `Document` only for granted ids not checked within it. Grants are read on
  every lookup, and Trash state too (`trashed_by_id.sql`, through
  `idx_document_trashed_id_owner`, which holds only trashed rows and stays
  cached): a revoked or new share, a move to or from the Trash, and a purge
  (which removes the grants) count at once; only a document given to another
  owner counts once its check expires. The checks are on in unit tests too,
  keyed by database and caller.
- `idx_document_trashed_id_owner` (migration `20261120081501`) is built
  concurrently. If the build is interrupted, inspect `pg_index.indisvalid` and
  drop only the invalid index before retrying.
- `recents::deleted` (the Trash list) pages by `("deletedAt", id)` through the
  partial trash indexes on `Document`, `Chat` and `Project`. A folder trash or
  batch move gives thousands of items one `"deletedAt"`, so the id tiebreak must
  stay in those indexes, and the list must not read without a page limit.
- `get_accessible_call_ids` (`call_record/get/accessible_call_ids.sql`) reads
  the caller's call grants by source and looks each granted call up by id;
  link shares cost one `SharePermission` probe per channel call, since a public
  call has no grant to start from. Never check a call's grants against the
  caller's sources row by row: that compares every grant with every source
  and took seconds for callers in thousands of channels.
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
- `idx_ep_crm_record_references_gin` (migration `20261119222316`) holds only the `entity_properties` values that reference a company or contact outside the Companies and Contacts properties and database rows. Soup's CRM property edges use it by repeating its predicate; keep the two in step. If its concurrent build is interrupted, inspect `pg_index.indisvalid` and drop only the invalid index before retrying.
- `document::get_all_documents::get_documents_to_delete` pages expired trash in `("deletedAt", id)` order through the partial `idx_document_deleted_at_id`, under a 10 s statement timeout; keep its `ORDER BY` and keyset comparison matching that index, or each page reads the whole Document table.

- `agent_correlation` owns invocation mappings; activity and scheduled-email correlation columns remain nullable for older writers. Build the activity correlation index concurrently, outside a transaction.
Hosted runtime enrollment generations are additive counters owned by
`hosted_runtimes`.

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
If the concurrent `password_activity_agent_requests` build (migration
`20261116152529`) is interrupted, inspect `pg_index.indisvalid` and drop only its
invalid index before retrying.

- `activity_events.agent_session_id` is filled only by the `activity_events_agent_session_id` insert trigger from `agent_correlations`; keep it when changing that table or the activity insert.

`crm_email_thread_exclusions` stores one contributor's private thread exceptions;
its membership, mailbox and thread foreign keys cascade deletion. The CRM domain
owns writes and owner-only listing; `crm_email_thread_excluded` is the independent
veto used by the shared eligibility function and mirrored in set-based ingestion
and the inline Team reader, including selected contribution.


Mailbox stream and reconciliation rows derive routing metadata from their
immutable link provider, including inserts from older binaries. Existing link-id
foreign keys retain ownership; do not add composite provider keys, cascading
provider updates or runtime constraint validation. Provider-prefixed claim
indexes retain old unprefixed indexes during rolling updates. An interrupted
concurrent build needs its INVALID index inspected and removed before retry.

`email_links.mailbox_issue` and `mailbox_retry_at` are nullable sync-health
projections, separate from `needs_reauth`; old binaries ignore them.

Work provider columns use a constant Outlook default without a heap rewrite.
Streams were Outlook-only; legacy reconciliation may include Gmail cleanup.
The singleton `email_reconciliation_provider_backfill` retains a bounded leased
cursor and completion marker. Cursor IDs have no foreign keys, so deleted links
do not erase progress. Keep the derivation trigger active for old inserts during
repair and rollback. Completing the bounded scan completes the job; it performs
no runtime DDL or validation scan. See the [repair runbook](../../docs/runbooks/email-provider-repair.md)
for the fresh-database requirement after removal of earlier unmerged migrations;
never edit a preserved database's migration ledger to bypass that incompatibility.

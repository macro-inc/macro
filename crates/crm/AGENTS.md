# crm

## What it is

Part of CRM (Sales): a hexagonal crate for companies, contacts, and
pipelines (including the legacy-CRM → Sales migration), plus the AI
tools/HTTP/GraphQL surfaces over them.

## Start here

- `src/domain/service.rs`, `src/domain/pipelines.rs`: core use cases.
- `src/domain/pipelines/requirements.rs`: stage-entry rules keyed by column and
  option IDs. `apply_ops` validates every pipeline write under the pipeline write
  guard; agent/CSV workflows use the same service. Deletions cascade rules.
- `src/domain/pipeline_workflows/`: pipeline entry/field/record ops built on
  the shared `databases` engine (Sales pipelines are a `databases` consumer).
- `src/domain/crm_csv.rs`, `src/domain/crm_transfer.rs`: CSV import/export for
  agents (companies, pipeline entries, pipeline exports). Writes go through the
  pipeline workflows and `CrmService`; CSV files reach documents through the
  `CsvFiles` port, implemented in `ai_tools::crm_csv_files`.
- `src/inbound/axum_router.rs` (+ `axum_router/*.rs`): HTTP handlers.
- `src/inbound/toolset.rs` (+ `toolset/*.rs`): AI tool definitions.
- `src/outbound/companies_repo.rs`: the Postgres adapter for companies/contacts.
- `SALES_BACKFILL.md`: how the legacy-CRM-to-Sales migration behaves.

## Scope

- Owns: CRM company/contact records, pipelines, and their HTTP/AI-tool/search
  surfaces for a team.
- Not here: the contact *graph* (who a user knows) → `crates/chat/contacts_core`;
  shared database storage/positions → `crates/databases`.

## Boundaries

- Cargo features gate what's pulled in: `lookup` and `search` are read-only,
  sqlx-only slices for other domains to depend on without pulling in
  `unfurl`/`axum`; pick the narrowest feature for a new caller.
- Depends on: `entity_access` (ports-and-adapters base), `databases` (ports),
  `filter_ast`, `item_filters`, `macro_authorization`, `properties`.
- Used by: `email`, `memory`, `ai_tools`, `soup`/`models_soup`, `graphql_crm`,
  `search_service`, `complete_graph`; composition roots include
  `document_storage_service`, `agent_harness_service`, `mcp_service`,
  `email_service`, `agent_trigger_service`, `scheduled_action`.

## Recipes

- Add an HTTP route: `src/domain/service.rs` (or a domain submodule) →
  `src/inbound/axum_router/<name>.rs` → `src/inbound/axum_router.rs` (mount it).
- Add an AI tool: `src/inbound/toolset/<name>.rs` → `src/inbound/toolset.rs`
  (register it) → its `test.rs`.
- Change pipeline behavior: `src/domain/pipelines.rs` or
  `src/domain/pipeline_workflows/*.rs` → `src/outbound/pipelines.rs` →
  matching test under `src/domain/pipeline_workflows/*/test.rs`.

## Checks

- `cargo test -p crm` (`SQLX_OFFLINE` unset; needs a local MacroDB — see
  `.agents/rules/rust/guardrails.md`). After query/migration changes, run
  `nix develop --command just prepare_db` from the repository root.
- After tool input or description changes, regenerate frontend tool types and
  public MCP reference pages using the
  [entity creation guide](../../docs/guides/add-entity.md#13-ai-and-mcp-tools);
  CI checks both outputs.

## Gotchas

- A generic pipeline has `record_type: None` and an unprotected primary column,
  which can change type or be deleted, leaving `primary_column_id` naming no
  column. Don't pass one to `referencing_rows`: its SQL reads primary cells as
  reference arrays. Don't add `ON DELETE` actions touching the pipeline row: they
  wait on the row lock the write guard holds, and the request hangs.
- Pipeline board-position reads require a pipeline View receipt, hold its live
  lifecycle guard, and scope the view to its backing table/database through
  `DatabaseStorage::storage_view_positions`.
- `src/domain/generic_email_domains.rs` filters both manual company creation
  and email-driven contact population. Cover legitimate company-domain
  exceptions with regression tests when correcting the blocklist.
- `resolve_association` also accepts `CrmAssociation::Activity`: all records in
  teams within the viewer/verified-bot scope, excluding hidden rows
  even for admins. Preserve distinct contact IDs that share an email; returned
  domains and addresses constrain the viewer's mailbox, not team email access.

- Manual companies require a name and accept an optional domain; explicit
  contact creation accepts any valid email, including personal providers.
  Email population still infers companies by domain. Do not apply manual
  creation rules to capture/consent; see `docs/design/crm-contact-creation.md`.
- Contact setters add email only when absent or link/switch company for a known
  personal-provider email; validate under the contact lock and reject same-team
  duplicates without disclosing restricted matches. Preserve ID, archive and sources.
- Personal sync and cleanup resolve one same-team/email contact across all companies,
  including hidden rows; skip ambiguous identities and preserve manual company choices.
- Serialize single and bulk source teardown company-before-source/contact, and
  re-read the target after waiting; orphan deletion must not cascade a new manual link.
- CRM availability is team membership, independent of contribution consent.
  Population takes the shared `crm-email:{team}` advisory lock before domain
  advisory locks, parent team `KEY SHARE`, then entity rows. Privacy changes
  take the exclusive privacy lock before domain/entity locks. Keep locks through
  commit; never wait on a domain or privacy lock after acquiring entity rows.
  Manual creation retains domain/parent/entity ordering without email consent.
  Contact field edits take exclusive privacy coordination before discovery/domain
  locks because reassignment changes contribution eligibility; they never require
  consent or enable sync. Assigned personal contacts under disabled parent sync
  retain their identity/company but receive no email-derived source/history writes.
  Legacy enable is a compatibility no-op; disable/purge is retired.
- Bound pipeline read- and write-guard waits with a transaction-local five-second
  timeout so waiters release pool connections needed by the holder's storage work.
- When depopulating an email, prefer its domain-linked contact over a manual
  unfiled record so mailbox-source teardown reaches the synced contact.
- Domain exclusions affect contribution and CRM email reads, never record
  visibility. Preserve archive state on block/unblock and consent withdrawal.
- Keep ambiguous CSV contact lookups unresolved without creating records for
  them; continue valid rows, but propagate lookup storage and authorization failures.

- Company names/logos live in the global `crm_domain_directory`. Only the
  email pubsub workers carry a real `CompanyMetadataResolver`, using public
  homepage metadata through `unfurl`; every other
  binary uses `NoOpCompanyMetadataResolver`, which leaves a pending entry
  (NULL `enriched_at`) that `CrmServiceImpl::enrich_pending_domains` resolves
  later with bounded retries. Never store an empty entry for a domain no
  resolver answered for: resolved entries are permanent.
- Apollo enrichment has been removed. Historical provider fields in the
  directory remain readable; do not clear existing metadata or drop columns
  as part of provider removal.
- Contacts carry their own `team_id`; `company_id` and `email` are optional.
  Scope contact reads by `ct.team_id` and LEFT JOIN the company for its
  `hidden` flag and name. Email sync files personal-provider addresses
  (`is_personal_email_domain`) as company-less contacts when no identity exists and the team
  turns `exclude_personal_emails` off; `crm_blocked_domains` stops sync per
  domain. CRM-scoped previews accept eligible company-less contacts using
  their team and email address. Company-less contacts add no independent
  thread-access grant, but hidden ones suppress their team's
  CRM-derived grant for members; independent access grants still apply.
- The Sales migration (`SALES_BACKFILL.md`) is forward-only and additive —
  its down migration refuses to erase completion or user edits; never revert
  it to undo a bad migration, only the application code that reads it.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `database-core`

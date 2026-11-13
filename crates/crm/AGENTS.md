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
  agents and the SDK (companies, pipeline entries, pipeline exports as text or
  a saved file). Writes go through the
  pipeline workflows and `CrmService`; CSV files reach documents through the
  `CsvFiles` port, implemented in `ai_tools::crm_csv_files`.
- `src/inbound/axum_router.rs` (+ `axum_router/*.rs`): HTTP handlers.
- `src/inbound/pipeline_workflows.rs`: HTTP routes over the pipeline workflows
  and CSV transfers (entries by record, fields by name, options by label),
  merged into `/crm` beside `src/inbound/pipelines.rs`; the SDK's pipeline
  entry methods call them, and `GET /crm/pipelines/details` (every pipeline
  with its fields and version, as `ListPipelines` sees them) backs
  `crm.pipelines.listWithFields()`.
- `src/inbound/toolset.rs` (+ `toolset/*.rs`): AI tool definitions.
- `src/inbound/company_list.rs`: `GET /crm/companies`, merged into `/crm`,
  runs the `ListCompanies` tool's listing (`toolset/list_companies.rs`
  `list_team_companies`) over HTTP for the SDK's `crm.listCompanies()`; its
  state carries the properties service the main CRM router does not.
- `src/outbound/companies_repo.rs`: the Postgres adapter for companies/contacts.
- `SALES_BACKFILL.md`: how the legacy-CRM-to-Sales migration behaves.

## Scope

- Owns: CRM company/contact records, pipelines, and their HTTP/AI-tool/search
  surfaces for a team.
- Not here: the contact *graph* (who a user knows) → `crates/contacts`;
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
- Contact setters add or remove an address, choose the primary, link/switch
  company for a personal-provider primary, or unlink a company; the rules live
  in `src/domain/contact_update.rs`. Validate under the contact lock and reject
  same-team duplicates without disclosing restricted matches. A new address
  must be free across the team; a link, switch or unlink re-checks every
  address the contact holds. Preserve ID, archive and sources.
- A company-domain contact has a company and an address on one of that
  company's `crm_domains` (`CrmContact::company_domain_emails`; there is no
  stored marker). It cannot be unlinked or moved, and its last such address
  cannot be removed. Read queries and the edit path compute it with the same
  SQL expression; keep them identical.
- Removing an address deletes only its `crm_contact_emails` row. Mailbox sources
  stay, removed addresses are not remembered, and later mail from one may file a
  fresh contact. Removing the primary promotes the oldest address left.
- Personal sync and cleanup resolve one same-team/email contact across all companies,
  including hidden rows; skip ambiguous identities and preserve manual company choices.
- Serialize single and bulk source teardown company-before-source/contact, and
  re-read the target after waiting; orphan deletion must not cascade a new manual link.
- CRM availability is team membership, independent of contribution consent.
  Population takes the shared `crm-email:{team}` advisory lock, then the
  `crm-contact:{team}:{link}:{email}` lock (which `depopulate_contact` also
  takes before its domain lock), parent team `KEY SHARE`, the mailbox scan,
  then the domain advisory lock and entity rows. Never run the mailbox scan
  under a domain lock: a team backfill queues every population of the domain
  behind it. Population transactions set a five-second `lock_timeout` and
  return `CrmError::Contended` so their job is deferred, not held. Privacy changes
  take the exclusive privacy lock before domain/entity locks. Keep locks through
  commit; never wait on a domain or privacy lock after acquiring CRM entity
  rows. Only shared team, mailbox and member row locks may precede a domain lock,
  and no domain-lock holder may lock those rows exclusively.
  Manual creation retains domain/parent/entity ordering without email consent.
  Contact field edits take exclusive privacy coordination before discovery/domain
  locks because reassignment changes contribution eligibility; they never require
  consent or enable sync. Assigned personal contacts under disabled parent sync
  retain their identity/company but receive no email-derived source/history writes.
  Legacy enable is a compatibility no-op; disable/purge is retired.
- Bound pipeline read- and write-guard waits, and contact population lock waits,
  with a transaction-local five-second timeout so waiters release pool
  connections needed by the holder's work.
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
- Every address a contact is known by is a row in `crm_contact_emails`, stored
  trimmed and lowercased. `crm_contacts.email` is the primary address, and a
  trigger records it in that table. Find a contact by address through
  `crm_contact_emails` (sync, teardown, email scope, thread access, call
  linking); read `crm_contacts.email` only to display the primary. Two
  paths still match the primary only: contact search and listing, and the
  activity scope, where joining every contact of a team to its addresses costs
  a probe per contact and needs its own plan. Company-domain population still
  upserts on company and primary, but first looks for a contact that holds the
  address as a further one and refreshes it instead: under the domain's
  company, or anywhere in the team when nobody is filed under the domain with
  it. A mailbox source is recorded per contact and mailbox, not per address:
  `depopulate_contact` keeps it while that mailbox still has mail with another
  of the contact's addresses (`other_address_mail.sql`), checked before the
  domain lock like population's mailbox scan.
- The Sales migration (`SALES_BACKFILL.md`) is forward-only and additive —
  its down migration refuses to erase completion or user edits; never revert
  it to undo a bad migration, only the application code that reads it.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `database-core`

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

- Pipeline board-position reads require a pipeline View receipt, hold its live
  lifecycle guard, and scope the view to its backing table/database through
  `DatabaseStorage::storage_view_positions`.
- `src/domain/generic_email_domains.rs` filters both manual company creation
  and email-driven contact population. Cover legitimate company-domain
  exceptions with regression tests when correcting the blocklist.
- `resolve_association` also accepts `CrmAssociation::Activity`: all records in
  CRM-enabled teams within the viewer/verified-bot scope, excluding hidden rows
  even for admins. Preserve distinct contact IDs that share an email; returned
  domains and addresses constrain the viewer's mailbox, not team email access.

- Manual companies require a name and accept an optional domain; explicit
  contact creation accepts any valid email, including personal providers.
  Email population still infers companies by domain. Do not apply manual
  creation rules to capture/consent; see `docs/design/crm-contact-creation.md`.
- Contact email/company setters mutate the existing ID within its owning team,
  preserve archive state and sources, and mark changed records manual; sync may
  recreate a separate inferred tuple, and email activity follows the current address.
- Serialize single and bulk source teardown company-before-source/contact, and
  re-read the target after waiting; orphan deletion must not cascade a new manual link.
- Keep CRM write locks ordered: domain advisory locks, parent team `KEY SHARE`,
  settings `SHARE`, then company/contact rows. Hold them through commit so
  disable/purge and team deletion cannot race creation.
- Bound pipeline read- and write-guard waits with a transaction-local five-second
  timeout so waiters release pool connections needed by the holder's storage work.
- When depopulating an email, prefer its domain-linked contact over a manual
  unfiled record so mailbox-source teardown reaches the synced contact.
- Serialize domain visibility updates on the owning company row before reading
  all its blocked domains; take no further domain locks after that row lock.
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
  (`is_personal_email_domain`) as company-less contacts only when the team
  turns `exclude_personal_emails` off; `crm_blocked_domains` stops sync per
  domain. CRM-scoped previews still require a company contact. Company-less
  contacts add no thread-access grant, but hidden ones suppress their team's
  CRM-derived grant for members; independent access grants still apply.
- The Sales migration (`SALES_BACKFILL.md`) is forward-only and additive —
  its down migration refuses to erase completion or user edits; never revert
  it to undo a bad migration, only the application code that reads it.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `database-core`

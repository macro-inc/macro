# crm

## What it is

Part of CRM (Sales): a hexagonal crate for companies, contacts, and
pipelines (including the legacy-CRM → Sales migration), plus the AI
tools/HTTP/GraphQL surfaces over them.

## Start here

- `src/domain/service.rs`, `src/domain/pipelines.rs`: core use cases.
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
  `reqwest`/`axum`; pick the narrowest feature for a new caller.
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

## Gotchas

- Company names/logos live in the global `crm_domain_directory`. Only the
  email pubsub workers carry a real `CompanyMetadataResolver`; every other
  binary uses `NoOpCompanyMetadataResolver`, which leaves a pending entry
  (NULL `enriched_at`) that `CrmServiceImpl::enrich_pending_domains` resolves
  later with bounded retries. Never store an empty entry for a domain no
  resolver answered for: resolved entries are permanent.
- The Sales migration (`SALES_BACKFILL.md`) is forward-only and additive —
  its down migration refuses to erase completion or user edits; never revert
  it to undo a bad migration, only the application code that reads it.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `database-core`

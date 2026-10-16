# documents

## What it is

The core of the Documents feature: document CRUD, content storage, AI
editing/tools, and file-type-specific services (spreadsheets, presentations,
word docs, Illustrator/Photoshop files).

## Start here

- `src/lib.rs`: the hexagonal layout (`domain`/`inbound`/`outbound`) and which
  Cargo features gate each module.
- `src/domain/service.rs` + `src/domain/ports.rs`: orchestration and the ports
  adapters implement.
- `src/domain/content.rs`: document content storage model (markdown vs legacy
  Office formats, S3 locations).
- `src/inbound/toolset.rs`: one submodule per AI document tool (`create_document`,
  `edit_document`, `word_document`, `spreadsheet`, `presentation`, ...).
- `src/inbound/axum_router.rs`: the HTTP surface; `axum_router/get_text.rs`
  serves `/text-content` through `src/domain/text.rs`. Native Markdown comes
  from live collaborative storage, not the legacy S3 export.

## Scope

- Owns: document lifecycle (create/rename/purge/upgrade), content storage and
  markdown backfill, comments, AI-editing tools, and file-type domain services
  (spreadsheet, presentation, word, illustrator, photoshop).
- Not here: realtime collaborative sync of document content → sync-service;
  the lexical markdown node/editor implementation → `packages/lexical-core`.

## Boundaries

- Depends on (feature-gated): `entity_access`/`entity_registry` (permissions),
  `ai_engine`/`ai_toolset`/`ai_billing`/`ai_usage` (AI tools), `pptx_engine`/
  `psd_engine` (file formats), `lexical_client` (sync-service calls),
  `comms_db_client` (create/purge adapters), `macro_db_client` (purge/backfill).
- Used by: `ai_tools`, `agent_harness`, `webhook`, `soup_realtime`, `memory`,
  `projects`, `skills`, `github` — this crate's service and toolset are widely
  reused; check callers before changing a port signature.

## Recipes

- Add an AI document tool: new module under `src/inbound/toolset/` → wire it
  into `src/inbound/toolset.rs` → register it where `ai_tools`/`crates/ai_tools`
  assembles the toolset.
- Add a document route: `src/domain/service.rs` (new domain method) →
  `src/inbound/axum_router.rs` → `src/domain/ports.rs` if it needs a new
  outbound capability.
- Change content storage/markdown lifecycle: `src/domain/content.rs` →
  `src/outbound/s3_markdown_source.rs` / `src/outbound/markdown_init.rs` →
  `src/bin/backfill_markdown_content_location.rs` if existing documents need
  migrating (run via `just backfill_markdown_content_location_dev` from this
  crate's `justfile`).

## Checks

- `cargo test -p documents --all-features` (`SQLX_OFFLINE` unset; needs a
  migrated local MacroDB for `outbound`/`document_create_adapters` tests).
- `just -f crates/documents/justfile check` for an all-features `cargo check`.

## Gotchas

- Features compose non-trivially (`inbound` pulls in `axum` and
  `document_create_adapters`; `ai_tools` pulls in `outbound` and `ports`) —
  check `Cargo.toml`'s `[features]` block before assuming a module compiles
  standalone.
- The markdown backfill binary defaults to dry-run; the `_apply`/prod `just`
  recipes require a typed confirmation before writing.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `collab-surface-core`

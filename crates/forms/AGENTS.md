# forms

## What it is

Backs the Forms feature: questionnaires that are views of a database table.
This crate owns form presentation, collaborative authoring, sharing, and the
response ledger; answers land as rows of the table through the `databases`
service.

## Start here

- `src/domain/service.rs`: the service — submodules are the use cases
  (`answers`, `create`, `drafts`, `layout`, `lifecycle`, `sharing`, `submit`);
  all authorization policy beyond receipt minting lives here.
- `src/domain/authoring.rs`: deterministic authoring workflows and the layout
  edit model — Loro owns live draft content, `src/domain/drafts.rs` is the
  validated relational projection the repository stores.
- `src/wiring.rs`: the one Postgres assembly every host builds from.
- `src/inbound/axum_router.rs` / `src/inbound/toolset.rs`: HTTP router and AI
  authoring tools.

## Scope

- Owns: form layout, authoring, sharing/audience, drafts, and submission
  ledger. Answer storage itself is the referenced database table.
- Not here: generic database row/column storage → `crates/databases`; the
  Loro document mechanics → `crates/collab_surface`.

## Boundaries

- Depends on: `databases` (ports), `collab_surface` (outbound, ports),
  `entity_access`, `models_forms`, `models_databases`, `macro_event_broker`,
  `static_file_service_client` (feature `static_files`: branding images must
  be the setter's own image uploads; `src/outbound/static_file_images.rs`).
- Used by: `document_storage_service`, `ai_tools`.

## Recipes

- Add a layout field: `src/domain/authoring/models.rs` → `src/domain/authoring/edit.rs`
  → `src/domain/authoring/validate.rs` → `src/outbound/collaborative_layout.rs`.
- Add an AI authoring tool: `src/inbound/toolset.rs` → `src/domain/authoring/workflow.rs`.
- Change section rules (gates, a questions section's `showWhen` branching):
  `models_forms` → `src/domain/service/layout.rs` (`validate_layout`,
  `gates_fit_table`) → `src/domain/service/answers.rs` (`evaluate`) →
  `src/domain/authoring/validate.rs` → `src/outbound/pg_forms_repo/layout.rs`.
  A skipped section's answers are ignored and count as unanswered.
- Add a submission rule: `src/domain/service.rs` (`submit`/`answers` modules)
  → `src/outbound/pg_forms_repo.rs`.

## Checks

- `cargo test -p forms --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- An anonymous form (`forms.anonymous`) keeps who responded in
  `form_submission_receipts` (no response, row or time) and writes ledger
  entries with no respondent, a random v4 id and the day only. Nothing may
  join the two: no span, log, event or row author names a voter next to a
  response.
- A form is filed in a folder on its own (`forms.project_id`, `MoveEntity`,
  owner only); its database stays where it is. The move bumps the old and new
  folder's `updatedAt`, as document and chat moves do. The folder's inherited
  grants on the form reach the database through form access, like any form
  grant.
- `POST /forms` attributes the creation to the SDK token's `agent_id` (code
  mode), like the native tool, so channel delivery shares a poll an agent
  posts; access checks still run as the plain user.

## Related

- Skills: `collab-surface-core`, `database-core` · Rules: `.agents/rules/rust/architecture.md`

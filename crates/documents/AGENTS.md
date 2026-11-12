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
- `src/domain/docx_export.rs`: DOCX export readiness policy; empty parts mean
  extraction is pending. Its entry point requires a checked document receipt.
- Native Canvas creation follows markdown: metadata → canonical shared snapshot →
  ready SyncService content, with compensation on failure. `create_canvas` and
  CreateDocument with empty Canvas content need no browser initialization.
- `DocumentToolContext::canvas_artifacts` is the per-user `enable-canvas-artifacts`
  rollout, off unless a host wires it; the Canvas tools pass it to the worker.
- `src/domain/canvas.rs`: permission-scoped Canvas read/render/edit workflows, native
  type checks, actor-bearing tokens, AI admission and per-model metering.
  `ReadCanvas`/`RenderCanvas` are view-scoped; `ApplyCanvasEdits` applies
  precise revision-checked SDK batches without a nested model, while `EditCanvas`
  delegates design work. Both use edit receipts and live scene
  deltas, never whole-file saves. Render output includes native media plus an
  immutable revision, crop/object mapping and actual DOM text bounds.
- `src/domain/word_document.rs`: Word tools read and edit the DOCX live copy
  through the editing worker. A DOCX nobody has opened yet is seeded first from
  its stored parts (`S3DocumentFiles`), in the editor's exact Loro shape
  (`word_document/seed.rs`, mirroring the web `writeCollabState`); keep the
  two in step.
- `src/inbound/toolset.rs`: one submodule per AI document tool (`create_document`,
  `edit_document`, `word_document`, `spreadsheet`, `presentation`, ...).
- `src/inbound/axum_router.rs`: the HTTP surface; `axum_router/get_text.rs`
  serves `/text-content` through `src/domain/text.rs`. Native Markdown comes
  from live collaborative storage, not the legacy S3 export.
- `src/domain/ai_edit.rs`: SDK editing of markdown documents and tasks by
  instructions. `POST /{id}/ai-edit` runs EditDocument's `AiEditingService`
  (admission, models, metering) with a token minted like EditDocument's: 422
  `edit_refused` is the worker's clarification, 502 `edit_failed` may have
  partly applied, and a client disconnect drops the worker call (never spawn
  it).
- `src/inbound/axum_router/canvas.rs`: the SDK's canvas routes,
  `POST /{id}/canvas/{scene,render,edits,ai-edit}`, over `CanvasService` with
  `CanvasRouteDeps`. Calls run as `CanvasCaller` (the acting user, plus the bot
  as token actor). `edits` answers 409 `revision_conflict` and 422
  `edit_rejected` when nothing committed, 502 `edit_failed` when it may have;
  `render` stores the PNG through the `CanvasImageStore` port (DSS adapter:
  `outbound/canvas_images.rs`).
- `src/inbound/axum_router/spreadsheet.rs`: SDK spreadsheets over the
  spreadsheet tools' `SpreadsheetService`: `POST /create_spreadsheet` and
  `POST /{id}/spreadsheet/read|calculate|edits`. Their tokens name the
  receipt's user and bot (`SpreadsheetCaller::Receipt`); the tools name the
  agent (`SpreadsheetCaller::Agent`). Worker 400/413 map to 400, 409 to a
  revision conflict, and anything else to 502 (an edit may have saved).
  `POST /{id}/spreadsheet/ai-edit` runs `SpreadsheetAiEditService`
  (`domain/spreadsheet/instructions.rs`): admission, the worker's writer model,
  and metering of its usage for every outcome; 422 refused, 409 conflict, 500
  failed unsaved, 502 may have saved.
- `axum_router/presentation.rs`, `word_document.rs`, `design_files.rs`: the
  presentation, Word, design, Photoshop and Illustrator tools over HTTP
  (`/{id}/presentation`, `/word`, `/design`, `/photoshop`, `/illustrator`),
  calling the same domain services with the same receipts. Word routes need
  an acting user; a bot caller's id rides in the worker token as the actor.
  Caller-fixable failures (`PresentationError`, `WordDocumentRejected`, the
  readers' errors) are 400s.
- `src/domain/markdown_body.rs`: `GET`/`PUT /{id}/markdown`, the SDK's
  `contentWithRevision`/`setContent`. The worker's `POST /markdown` reads the
  body with sync-service's revision and commits a write only at the revision
  the caller read (409 `revision_conflict` otherwise). No model, no billing.
- `src/domain/text_comment.rs`: a comment thread anchored to quoted text, shared
  by the `CommentOnText` tool and `POST /{id}/comments/text` (the SDK's
  `Document.commentOnText`). Markdown places the mark first and removes it if
  the post fails; 422 `quote_not_placed` is an ambiguous or missing quote. Word
  posts with the quote for the editor to place.
- `axum_router/upload_file.rs`: `POST /upload` takes a file's raw bytes (25 MiB)
  and runs UploadFile's `DocumentCreator::upload_file`, minting the project
  receipt from the caller like the tool. It exists for clients that cannot PUT
  to presigned storage URLs, such as code mode's sandbox.

## Scope

- Copying a legacy Canvas preserves its JSON seed and live sync room. Native
  Canvas copies use the room and retain the SyncService content location. Failed
  copies compensate destination storage and sync artifacts before
  removing the new document rows, logging cleanup failures independently.
- Owns: document lifecycle (create/rename/purge/upgrade), content storage and
  markdown backfill, comments, AI-editing tools, and file-type domain services
  (spreadsheet, presentation, word, illustrator, photoshop).
- Not here: realtime collaborative sync of document content → sync-service;
  the lexical markdown node/editor implementation → `packages/lexical-core`;
  Discussion comments, replies and thread state on any entity → the `messages`
  toolset (this crate keeps only `CommentOnText`, the inline comment that
  places a mark).

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
- Create a document from a Notion page: `DocumentCreator::create_notion_markdown`
  (`src/domain/create.rs`) with a `NotionMarkdown` (`src/domain/notion_markdown.rs`);
  lexical-service converts it through `MarkdownInitializationPort::initialize_existing_notion`
  and returns the Macro markdown that mention tracking reads.
- Create a document with its source's dates (an import): set
  `NewDocumentMetadata::builder(..).created_at(..).updated_at(..)`. Its folder
  and every folder above it then widen to those dates (`extend_project_dates`)
  instead of being marked updated now.
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

- Signed document grants carry agent correlation into Sync; editor deduplication and activity debounce include the invocation ID.

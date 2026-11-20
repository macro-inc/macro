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
- `src/domain/service/lifecycle.rs`: `DocumentLifecycleReads` supplies physical
  existence/trash facts to trusted imports through the owning repository port.
  Missing rows are false; read failures propagate. No viewer or content access.
- `src/domain/content.rs`: document content storage model (markdown vs legacy
  Office formats, S3 locations).
- `src/domain/docx_export.rs`: DOCX export readiness policy; empty parts mean
  extraction is pending. Its entry point requires a checked document receipt.
- Native Canvas creation follows markdown: metadata → canonical shared snapshot →
  ready SyncService content, with compensation on failure. `create_canvas` and
  CreateDocument with empty Canvas content need no browser initialization.
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
  from live collaborative storage, not the legacy S3 export, in the same
  internal format as `/{id}/markdown`. A write-back still takes its text and
  revision from one `/{id}/markdown` read (`contentWithRevision`), so it can't
  overwrite a change made after the text was read.
- `axum_router/appearance.rs` edits ordinary Markdown/snippet appearance through
  Edit receipts with atomic attributed history; copies and metadata reads retain
  overrides without changing content dates.
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
- Create tasks with explicit title pins by passing property definition IDs through `MarkdownSubtype::Task`; `MarkdownInitializationOptions` carries optional pins across the domain ports, leaving omitted pins implicit and preserving explicit empty lists.
- Persist explicitly pinned empty fields as task-owned null assignments so every authorized task viewer can resolve them.
- Create a document from a Notion page: `DocumentCreator::create_notion_markdown`
  (`src/domain/create.rs`) with a `NotionMarkdown` (`src/domain/notion_markdown.rs`);
  lexical-service converts it through `MarkdownInitializationPort::initialize_existing_notion`
  and returns the Macro markdown that mention tracking reads.
- Set creation-time link access with the canonical
  `models_permissions::share_permission::InitialLinkShare` (re-exported from
  `domain::models`); `NewDocumentMetadata::builder(..).initial_link_share(Off)`
  selects `Exact(Off)` before the document row is inserted.
- Create a document with its source's dates (an import): set
  `NewDocumentMetadata::builder(..).created_at(..).updated_at(..)`. Its folder
  and every folder above it then widen to those dates (`extend_project_dates`)
  instead of being marked updated now.
- Change content storage/markdown lifecycle: `src/domain/content.rs` →
  `src/outbound/s3_markdown_source.rs` / `src/outbound/markdown_init.rs` →
  `src/bin/backfill_markdown_content_location.rs` if existing documents need
  migrating (run via `just backfill_markdown_content_location_dev` from this
  crate's `justfile`).
- Queue email attachments that lost their links before the released-attachment
  queue existed: `src/bin/enqueue_orphaned_email_attachments.rs` over
  `src/domain/released_attachments/orphans.rs`; see
  [Orphaned email attachment scan](#orphaned-email-attachment-scan).

Appearance writes use `activity::AppearanceUpdate` in the repository transaction;
realtime appearance events do not re-ingest history.

## Checks

- `cargo test -p documents --all-features` (`SQLX_OFFLINE` unset; needs a
  migrated local MacroDB for `outbound`/`document_create_adapters` tests).
- Point `REDIS_URL` at the local Redis endpoint for editing-session tests;
  the default is `redis://127.0.0.1:6379`.
- `just -f crates/documents/justfile check` for an all-features `cargo check`.

## Gotchas

- Features compose non-trivially (`inbound` pulls in `axum` and
  `document_create_adapters`; `ai_tools` pulls in `outbound` and `ports`) —
  check `Cargo.toml`'s `[features]` block before assuming a module compiles
  standalone.
- The markdown backfill binary defaults to dry-run; the `_apply`/prod `just`
  recipes require a typed confirmation before writing.
- `domain/released_attachments.rs` trashes email attachments whose mail is
  gone, draining `released_email_attachment_documents` (filled by a trigger
  when a statement deletes a document's `document_email` rows) in batches of
  500, at most 20 batches per round. Its repository
  (`outbound/pg_released_attachments.rs`) restates
  `PgDocumentRepo::soft_delete_document`'s writes set-based; change the two
  together, and keep its adoption checks (folder, grant or sharing change, an
  `edited` activity from `edit_document`, a second version without PDF
  modification data, a placeable added, changed or removed in the PDF
  viewer, PDF annotation, comment thread) in step with any new way to file,
  share or edit a document. Opening is not adopting: the PDF viewer saves a
  version holding only its modification data on the first open by anyone who
  can edit, so a version alone proves nothing. A document with no link left
  is trashed, or kept as it is when adopted or already in the Trash. Each
  batch publishes one `document.email_attachments_released` event naming its
  trashed and kept documents; Soup realtime removes the trashed ones from open
  lists, as for the documents of a trashed folder, and nothing else reacts
  per document.
  Link an existing document to an attachment with
  `create::link_live_document_email`: its key-share lock orders the link with
  the drain's `FOR UPDATE`, so a document the drain trashed after a reuse
  lookup is never linked. The orphan scan (`released_attachments/orphans.rs`)
  previews the drain through the same `classify` query; keep it shared.
- `edit_document.rs` refuses a share permission change from a scoped agent
  session (`agent_correlation::context::refuse_sharing`, 403); a new sharing
  field that isn't a grant joins that check. Grants are checked where they are
  written (`entity_access_db_utils::scoped_grants`); creating or moving a
  document into a folder calls `project_grants::refuse_filing(_in)` in the
  transaction that writes `projectId`, because the folder's grants are
  inherited after commit; a document whose id isn't a UUID calls
  `project_grants::refuse_unregistered_filing` instead, before the write.
  Under such a scope a task defaults to unshared but
  keeps its team number (`CreateTaskRequest::share_with_team`).

## Orphaned email attachment scan

`enqueue_orphaned_email_attachments` finds documents that lost their email link
before the released-attachment queue existed: a live document whose Source
property names an email thread, with no `document_email` row. It queues them in
`released_email_attachment_documents`, so the drain's checks trash or keep each
one as they do a document released today.

- Run it only once #10948 (the queue and its drain) and #10942 (bounded trash
  expiry) are both in the production release. Without the drain the queue only
  grows; without bounded expiry, everything it trashes comes due for purge in
  the same few hours 30 days later.
- The rollout's coordinator runs it, through this crate's `just` recipes, with
  an absolute `--state-file` path.
- Dry run first (`enqueue_orphaned_email_attachments_prod`; it refuses
  `--apply`). It writes only the state file and reports the orphans by cause
  (mailbox gone, mailbox connected again after the import, thread gone,
  message gone, attachment replaced) and what the drain would do with them:
  trash, keep as adopted, keep as already in the Trash, or skip as linked
  again. Then run `enqueue_orphaned_email_attachments_prod_apply` with a new
  state file.
- Only a Source the import wrote counts: the import inserts Source and
  Recipients in one statement and never updates them, so the Source row's
  `created_at` equals the Recipients row's and its `updated_at` its own
  `created_at`. Anyone who can edit a document can set its Source to a thread
  by hand (the properties panel, the SDK's `setProperty` and its MCP tool, the
  agent's `SetEntityProperty`), one property per statement; those documents
  are counted as `source_not_from_import` and never queued. The document's
  creation time can't tell the two apart: a backfilled import is dated by its
  mail.
- Rate: on average at most `--per-second` (default 100) orphans are queued a
  second; a page's orphans go in one insert and the scan then waits out their
  share. It waits while more than `--max-queue-depth` (default 10,000, one
  drain round) are queued. The drain runs a round of 20 batches of 500 per
  notification and one a minute without any, so 10,000 a minute is its floor
  even if notifications are lost; 100 a second is 6,000 a minute and leaves
  the rest of each round to documents released by mail deleted now. The scan
  notifies once per 500 queued, so its rounds drain whole batches: each batch
  publishes one `document.email_attachments_released` event, which Soup
  realtime turns into one removal per trashed document in open lists.
- Resume: the cursor and counts are saved to the state file after every page;
  rerun with the same file to continue. `--after <entity id>` starts elsewhere
  with fresh counts. A state file belongs to one mode, dry run or `--apply`.
  Any error stops the scan with its last cursor printed; nothing retries. A
  rerun is safe: queuing skips documents already queued, a trashed document is
  no longer an orphan, and only adopted ones are queued again, to be kept again.
- A page reads `--page-size` (default 500) `entity_properties` rows through
  `idx_entity_properties_entity_id`, then probes each entity in them by
  `(entity_id, entity_type)` and picks its Source row outside an `OFFSET 0`
  fence. A range over the window, or a probe naming the definition, lets stale
  statistics read every Source row through
  `idx_entity_properties_property_definition_id`. Each page is one
  `document.orphaned_attachments.page` span with its cursor and counts, and a
  progress line is logged every 30 seconds; an applied scan's line also has
  `queued_per_minute` since the previous line and the `queue.depth` it last
  read, to tune `--per-second` between runs (stop it, rerun with the same
  state file and a new rate). A page is about ten round trips
  to the database, which dominate from outside AWS; a larger `--page-size`
  (at most 2,000, so a page read from disk stays well inside its 10 s
  statement timeout) shortens a dry run.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `collab-surface-core`

- Signed document grants carry agent correlation into Sync; editor deduplication and activity debounce include the invocation ID.

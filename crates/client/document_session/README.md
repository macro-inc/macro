# document_session

A sans-I/O document session composes `doc_sync_core` with an editor or generic
Loro containers. The host supplies fresh peer identities, both clocks, storage,
transport and timer completions. One host event calls `handle` once and consumes
its ordered view and I/O effects before the next call.

Construct `DocumentSession<EditorSurface>` with `SurfaceConfig::Editor`, or
`DocumentSession<GenericSurface>` with `SurfaceConfig::Generic`. Deliver
`Sync(Start)` and then offer the optimistic seed and deliver durable load completions.
Every seed waits for startup WAL adoption; the first initialized surface includes
the recovered rows. Earlier cached/optimistic offers retain their arbitration
position; a local snapshot has priority over Remote, and a corrupt local
snapshot can fall back to a queued remote seed after adoption.
Initialization drains editor hook output, projects it before accepting edits,
and rebuilds bindings and undo after a reset. Empty read/comment-only documents
render without creating native operations. The default editor factory includes
core/rich nodes; an application can supply its own rebuildable factory and sync
policy. The Macro registry integration is deferred to WP-28.

Send `Focus(bool)` when the host gains or loses focus; this preserves logical
selection while suppressing host caret effects on remote updates during blur.
Without explicit focus inputs, selection and typing events infer focus.

Editor inputs use Loro history with deterministic grouping on the supplied clock.
Batched history controls are rejected atomically; send each undo, redo or clear
control as its own input. Remote repairs are written immediately with the
history-excluded origin. Local projection recovery preserves the native document
and undo manager, and charges the core's recovery budget.

Generic batches validate their complete semantic effect before touching live
containers. Text indices use UTF-16 and reject surrogate splits. Read through
`session.read(path)`; observed native events include ancestor replacements and
deletions of a configured nested path.

`Sync(Flush(request))` waits for durability and delivery. Comment publication
catches up, checks local delivery, stages on a fresh peer and imports only an
accepted echo. Existing marks make retries idempotent even with stale cursors.
Comment updates never enter the WAL.

Cold editor flows use content-free tracing spans. Keystrokes emit no spans or
I/O during the coalescing window. See `AGENTS.md` for checks and the independent
four-peer TypeScript/native differential under `packages/lexical-conformance/diff/collab/`.

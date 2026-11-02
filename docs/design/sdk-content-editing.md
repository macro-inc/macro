# SDK content editing

**Status:** Proposed. Implementation follows the PR plan at the end.

Macro tasks: MACRO-4588 (documents and tasks), MACRO-4587 (spreadsheets),
MACRO-4581 (Word and PowerPoint), MACRO-4584 (canvases).

## Goal

Code-mode agents run JavaScript against `@macro-inc/sdk` in a Deno sandbox.
Today the SDK can create content but not change it. Every edit of an existing
document, task description, spreadsheet, Word file, deck or canvas needs a
direct tool (`EditDocument`, `EditSpreadsheet`, `EditWordDocument`,
`EditPresentation`, `ApplyCanvasEdits`). This design gives the SDK typed read
and edit methods for each type, with the same guarantees as those tools, so
the tools can be removed later.

Out of scope: removing direct tools, uploading or downloading file bytes
(separate task), and AI edits by instruction (`EditDocument`'s nested model),
which an agent that writes code doesn't need.

## What exists

Every direct edit tool has the same two layers:

1. **An op builder**, used by the editing model. For markdown it is
   `DocumentEditor` (`services/ai-editing-worker/src/ai-editing/editor/`): about
   100 methods that validate arguments and append plain-data `DocumentOp`s. It
   imports nothing from Lexical. `CanvasEditor` (`src/canvas/editor.ts`) does the
   same for `CanvasOp`. Spreadsheets (`packages/spreadsheet/src/ai-types.ts`),
   Word (`crates/documents/src/domain/word_document/models.rs`) and PowerPoint
   (`pptx_engine::EditOp`) take op arrays as plain JSON.
2. **An engine that commits the ops**, on the server:

| Type | Engine | Storage | Concurrency today |
| --- | --- | --- | --- |
| Markdown, tasks | `Doc` in ai-editing-worker, joined as a live Loro peer | sync-service | CRDT merge; ops address durable node ids |
| Spreadsheet | `prepareSpreadsheetEdit` (`packages/spreadsheet`, IronCalc WASM) in the worker | sync-service | Strict revision check; 409 on any change since the read |
| Word | `editWord` (`packages/collaboration/src/docx`) in the worker, live peer | sync-service | CRDT merge; block ids |
| PowerPoint | `pptx_engine` natively in `crates/documents` | S3 version per edit | None: last writer wins |
| Canvas | `CanvasSession` in the worker, live peer, text measured and rendered in Browser Rendering | sync-service | Revision hash; unrelated concurrent edits rebased |

The sandbox (`crates/code_execution`) runs a fresh `deno` process per call:
30 s, 128 MiB heap, `--deny-import --no-remote --no-npm`, and network limited
to the hosts in `sdk_hosts()` (DSS, auth, cognition, email and others). Neither
sync-service nor the ai-editing-worker is on that list. The SDK bundle
(`sdk.mjs`, 375 KB) has no WASM.

## Decision: build ops in the sandbox, commit them on the server

For every type, the SDK ships the **op builder and op types**, vendored from
the package that owns them, and sends the resulting ops to a **DSS route** that
commits them with the **same engine the direct tool uses**. Reads come back
from the same engine, in the same format the tools return.

```
sandbox                                 DSS (crates/documents)         engine
─────────────────────────────           ───────────────────────        ────────────────────
doc.structure()  ──GET /documents/{id}/structure──▶ receipt ──▶ lexical-service /xml
  .edit(e => e.replace(id, 'a', 'b'))
     vendored DocumentEditor → ops ──POST /documents/{id}/edits──▶ receipt, md only,
                                                     scoped token ──▶ worker /document-ops
                                                                      (live Loro peer, Doc)
```

### Why not run the engines in the sandbox

Running Loro, Lexical and IronCalc inside the sandbox, as a sync peer, was the
alternative. It loses on every criterion the goals list:

- **Live collaboration.** A sandbox peer would need sync-service on the
  allowlist, a WebSocket peer or the strict-revision `/update` route (which
  fails on any concurrent keystroke), a reserved AI peer id, and the worker's
  remote-state folding. The worker already does all of this and is tested for it
  (`doc/concurrency.test.ts`).
- **Network.** sync-service is a `workers.dev` host outside the gateway, and the
  scoped document token the worker uses is minted by DSS. Adding both widens the
  sandbox for no gain.
- **Bundle size and Deno.** loro-crdt WASM is 3.3 MB, IronCalc 2.2 MB, the pptx
  engine several MB of font data. Inlined into `sdk.mjs`, that is written to
  disk and compiled on every execution, including the many that never edit.
- **Parity.** Canvas text fitting needs a browser and rendering needs Chromium.
  PowerPoint's read format (`describe.rs`) lives in Rust in `crates/documents`,
  and its file is in S3, which the sandbox can't reach. Two of the five types
  can't run in the sandbox at all.
- **One source of truth.** Ops committed by the tool's own engine behave the same
  whether a model or a program wrote them.

What *does* belong in the sandbox is the builder: it is pure, small, and is the
API the agent writes against. Running it locally gives the agent typed methods,
immediate argument errors, and new-node ids it can use later in the same batch.

## SDK API

Methods live on entity handles (`.agents/rules/sdk.md`). A program reads first,
then edits against that read:

```js
const doc = await macro.documents.byId(id); // or a Task; Task extends Document
const structure = await doc.structure();     // { xml } with durable node ids
const result = await structure.edit((editor) => {
  editor.replace('k3Fq', 'Q3', 'Q4');
  const heading = editor.appendBlock({ block: 'heading', level: 2, text: 'Next steps' });
  editor.insertListItemAfter(heading, 'Ship it', 'check');
});
// result: { applied: 3, created: [...ids] }
```

- **Reads** return the format the matching tool returns, so prompts and docs
  carry over. Markdown: the XML view (`toXml`, node ids as attributes).
  Spreadsheet: `{revision, sheets, ranges}`. Word: block list with ids.
  PowerPoint: the `describe` outline. Canvas: the scene JSON and its revision.
- **Edits** take a builder callback (`DocumentEditor`, `CanvasEditor`) or a typed
  op array (spreadsheet, Word, PowerPoint), and return what the tool returns.
- **Revisions and conflicts** follow each engine, typed as SDK errors:
  - Markdown and Word merge with concurrent edits. A batch is all-or-nothing:
    the worker applies it to a scratch copy of the live state first, and if any
    op fails (a node someone deleted, text no longer found) nothing is committed
    and `DocumentEditError` lists each failed op.
  - Spreadsheets carry `expectedRevision` from the read; a change since then
    raises `RevisionConflictError` and the program reads again.
  - Canvases carry `expectedRevision`; the worker rebases unrelated concurrent
    edits and raises `RevisionConflictError` only for real conflicts.
  - PowerPoint gains a revision: the read returns the version it described, and
    the edit is refused if a newer version exists. This replaces today's
    last-writer-wins.
  - A lost acknowledgement is reported as `EditOutcomeUnknownError` ("may have
    applied; read before retrying"), as the canvas tool already does.
- **Handles:** `Document.spreadsheet()`, `.wordDocument()`, `.presentation()`,
  `.canvas()` return typed handles (`Spreadsheet`, ...) that refuse the wrong
  file type. Each has `webUrl()`. `documents.createSpreadsheet()` joins the
  existing `createCanvas()`.

### Saved database questions in documents

`Table.saveQuery({ sql, title, display })` (separate task) returns a
`SavedQuery` handle with `toBlock()`, the saved question's `<m-db-query>`
block. The document editor accepts that handle wherever #9333's builder takes a
block, so a program places a live answer, table or chart without handling the
block text:

```js
const query = await table.saveQuery({ sql, title: 'Pipeline', display: 'bar' });
await structure.edit((editor) => {
  editor.insertDatabaseQueryAfter('k3Fq', query);
  editor.setDatabaseQueryView('a9Lm', { displayMode: 'pie', title: 'Share' });
  editor.setDatabaseLocation('c2Xw', { tableId: accounts.id });
});
```

The SQL stays on the server: the block carries only the query id and its
presentation, and the worker refuses blocks without a query id (as #9333 does).
The builder takes `string | { toBlock(): string }`, so the vendored code stays
free of SDK types, the model-facing sandbox keeps passing strings, and the SDK
documents the parameter as a `SavedQuery`. `setDatabaseLocation` names a table
by id inside the op, since it is node data, not an SDK call.

## How vendoring works

- **The builder lives in a package, not the worker.** The first PR moves
  `editor/ops.ts`, `document-editor.ts` and `errors.ts` from the worker into
  `packages/editor-ops/src/document/`. The worker, its QuickJS sandbox bundle
  (`scripts/generate-sandbox.ts`) and the SDK all import it from there. Canvas's
  builder moves to `packages/editor-ops/src/canvas/` in its PR. Spreadsheet op
  types already live in `packages/spreadsheet/src/ai-types.ts`; Word's in
  `packages/collaboration/src/docx`.
- **The SDK copies the files in at build time.** `packages/sdk` is a standalone
  package with its own lockfile, its esbuild bundle inlines everything except
  `node:*`, and `tsc` declaration emit is rooted at the package. A
  `scripts/vendor.ts` copies the listed source files into `packages/sdk/vendor/`,
  with `--check` in CI like `generated/`. The files have no runtime
  dependencies, so SDK users get no new npm dependencies, and TypeDoc and
  declaration emit see ordinary package files. Type-only imports (for example
  lexical-core's database-query types) are vendored with them.
- **Versioning.** The vendored builder and the server engine come from the same
  commit. A program built against an older published SDK still works while the
  op vocabulary only grows. Changing an op's meaning needs a new op kind,
  because the published SDK and the deployed worker can differ.
- **Size.** The builders add about 30 KB unminified to `sdk.mjs` and no WASM.
- **Docs budget.** Each entity index must stay under 16 KiB, 32 KiB per tool
  result, at most 32 topics (30 used). `DocumentEditor` gets its own topic,
  `document-editing`, so its roughly 100 methods don't crowd the documents
  index; alias families (`bold`/`unbold`/...) share one summary. Spreadsheet,
  Word, PowerPoint and canvas handles share one `office` topic if they fit,
  which keeps the count at 32. Each PR measures its index and adds worked
  examples to the topic's TSDoc and the code-mode examples guide.

## PR plan

Each PR is independently mergeable, adds tests first, and regenerates the SDK
reference, the code-mode bundle and `documentation.json`.

1. **This design** (docs only).
2. **Documents and tasks** (MACRO-4588), stacked on #9333 for its database
   ops. `packages/editor-ops` with the document builder (accepting `SavedQuery`
   handles); worker `POST /document-ops`, model-free and all-or-nothing; DSS
   `GET /documents/{id}/structure` and `POST /documents/{id}/edits`; SDK vendor
   script, `Document.structure()` and `DocumentStructure.edit()`; tests for
   round trips, concurrent typing during an edit, and refused batches.
3. **Spreadsheets** (MACRO-4587). DSS routes over `SpreadsheetService` (read,
   calculate, edit), `documents.createSpreadsheet()`, `Spreadsheet` handle,
   vendored op types.
4. **Word and PowerPoint** (MACRO-4581). DSS routes over `WordDocumentService`
   and `PresentationService`; PowerPoint version check; `saveAs` returns a
   `Presentation` handle.
5. **Canvases** (MACRO-4584). `CanvasEditor` moves to `packages/editor-ops`;
   the worker accepts ops as well as code; DSS read, apply and render routes;
   render returns PNG bytes and the crop it used.

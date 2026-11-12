# SDK content editing

**Status:** Proposed. Implementation follows the PR plan at the end.

Macro tasks: MACRO-4588 (documents and tasks), MACRO-4587 (spreadsheets),
MACRO-4581 (Word and PowerPoint), MACRO-4584 (canvases).

## Goal

Code-mode agents run JavaScript against `@macro-inc/sdk` in a Deno sandbox.
Today the SDK can create content but not change it. Every edit of an existing
document, task description, spreadsheet, Word file, deck or canvas needs a
direct tool (`EditDocument`, `EditSpreadsheet`, `EditWordDocument`,
`EditPresentation`, `EditCanvas`, `ApplyCanvasEdits`). This design gives the
SDK read and edit methods for each type, with the same guarantees as those
tools, and hides each tool from code-mode sessions once its SDK method exists.

The primary API is an edit by **natural-language instructions**, run by the
same AI-editing pipeline the direct tool uses: `await doc.edit('…')`.
Deterministic, typed operations stay as a lower layer, only where instructions
are a poor fit.

Out of scope: removing direct tools from non-code-mode hosts, and uploading or
downloading file bytes (separate task).

## What exists

Every direct edit tool has the same two layers:

1. **A writer.** For markdown and canvases a model writes the edit:
   `EditDocument` and `EditCanvas` take instructions, and the ai-editing worker
   turns them into ops with nested models. The ops come from a pure op builder:
   `DocumentEditor` (`services/ai-editing-worker/src/ai-editing/editor/`), about
   100 methods that validate arguments and append plain-data `DocumentOp`s, and
   `CanvasEditor` (`src/canvas/editor.ts`) for `CanvasOp`. Spreadsheets
   (`packages/spreadsheet/src/ai-types.ts`), Word
   (`crates/documents/src/domain/word_document/models.rs`) and PowerPoint
   (`pptx_engine::EditOp`) have no model on the server: their tools take op
   arrays, written by the calling agent.
2. **An engine that commits the ops**, on the server:

| Type | Instructions editor on the server | Engine | Concurrency today |
| --- | --- | --- | --- |
| Markdown, tasks | Yes (`EditDocument`) | `Doc` in ai-editing-worker, a live Loro peer of sync-service | CRDT merge; ops address durable node ids |
| Spreadsheet | No (`EditSpreadsheet` takes ops) | `prepareSpreadsheetEdit` (`packages/spreadsheet`, IronCalc WASM) in the worker | Strict revision check; 409 on any change since the read |
| Word | No (`EditWordDocument` takes ops) | `editWord` (`packages/collaboration/src/docx`) in the worker, live peer | CRDT merge; block ids |
| PowerPoint | No (`EditPresentation` takes ops) | `pptx_engine` natively in `crates/documents`, S3 version per edit | None: last writer wins |
| Canvas | Yes (`EditCanvas`) | `CanvasSession` in the worker, live peer, text measured and rendered in Browser Rendering | Revision hash; unrelated concurrent edits rebased |

The sandbox (`crates/code_execution`) runs a fresh `deno` process per call:
30 s, 128 MiB heap, `--deny-import --no-remote --no-npm`, and network limited
to the hosts in `sdk_endpoints()` (DSS, auth, cognition, email and others). Neither
sync-service nor the ai-editing-worker is on that list. The SDK bundle
(`sdk.mjs`, 375 KB) has no WASM.

## Decision: edit on the server, behind DSS routes

Every edit runs on the server, through a **DSS route** that authorizes it the
way the direct tool does and calls the **same engine**:

```
sandbox                       DSS (crates/documents)               ai-editing worker
───────────────────           ─────────────────────────            ─────────────────────
doc.edit('…', opts)  ──POST /documents/{id}/ai-edit──▶ edit receipt,  ──▶ /edit: models write
                                                    AI admission,        ops, Doc applies them
                                                    scoped token         as a live Loro peer
doc.structure()      ──GET  /documents/{id}/structure──▶ view receipt ──▶ lexical-service /xml
structure.applyEdits(e => …)
  vendored DocumentEditor → ops ──POST /documents/{id}/edits──▶ edit receipt ──▶ /document-ops:
                                                                           no model, all or nothing
```

### Why not run the engines in the sandbox

Running Loro, Lexical and IronCalc inside the sandbox, as a sync peer, was the
alternative. It loses on every criterion:

- **Live collaboration.** A sandbox peer would need sync-service on the
  allowlist, a WebSocket peer or the strict-revision `/update` route (which
  fails on any concurrent keystroke), a reserved AI peer id, and the worker's
  remote-state folding. The worker already does all of this and is tested for it
  (`doc/concurrency.test.ts`).
- **Network.** sync-service is a `workers.dev` host outside the gateway, and the
  scoped document token the worker uses is minted by DSS. Adding both widens the
  sandbox for no gain.
- **Bundle size and Deno.** loro-crdt WASM is 3.3 MB, IronCalc 2.2 MB, the pptx
  and docx engines 11 MB and 8.5 MB (2.3 MB of each is fonts). Inlined into
  `sdk.mjs`, that is written to disk and compiled on every execution, including
  the many that never edit.
- **Parity.** Instruction edits need the worker's models. Canvas text fitting
  needs a browser and rendering needs Chromium. PowerPoint's read format
  (`describe.rs`) lives in Rust, and its file is in S3, which the sandbox can't
  reach.
- **One source of truth.** Ops committed by the tool's own engine behave the same
  whether a model or a program wrote them.

## SDK API

Methods live on entity handles (`.agents/rules/sdk.md`). `Task` extends
`Document`, so every document method edits a task's body too.

### Primary: `edit(instructions, opts?)`

```js
const result = await doc.edit(
  'In the "Risks" section, replace the paragraph starting "We expect" with two ' +
    'bullet points: supplier delay and hiring. Keep the heading unchanged.',
);
// { revision, webUrl }, plus clarification after a partial edit
```

- **Instructions** are natural language. The TSDoc says how to write good ones:
  name the section or quote the text to change, describe the outcome rather
  than the steps, and say what must stay as it is.
- **`opts.queries`** (with #9333's database ops): `SavedQuery` handles to
  place. `Table.saveQuery({ sql, title, display })` (separate task) returns a
  handle whose `toBlock()` is the saved question's `<m-db-query>` block. The SDK
  appends the blocks to the instructions verbatim, so the model places a live
  answer, table or chart and never sees or writes SQL.
- **`opts.fast`**: the worker's single-model fast mode, as `EditDocument`'s
  `fast`. It suits small, local edits.
- **`opts.signal`**: an `AbortSignal` that cancels the edit end to end (below).
- **Result**: `revision` (the document's version after the edit: the base64
  Loro version vector, as sync-service encodes it) and `webUrl`, plus
  `clarification` when the editor applied part of the edit and stopped. No
  diff: the program reads the document again to see what changed.
- **Errors**: `DocumentEditRefusedError` with the editor's reason when it
  can't do the edit (the worker's clarification, an invalid block, a saved
  question without a query id); nothing changed. `EditOutcomeUnknownError` when
  the outcome is unknown. Admission (`AiFeature::AiEditing`) and billing apply,
  as for `EditDocument`.
- **Merging**: the worker edits as a live peer, so collaborators' typing during
  the edit is kept; nothing is overwritten.
- **Time**: an edit by the full pipeline can take longer than code mode's 30 s
  deadline. `opts.fast` and one edit per call keep edits inside it; the docs say
  so, and the PR measures typical durations. A sandbox killed mid-edit cancels
  like an abort.

#### Aborting

AI edits can be aborted. Code mode has no timers, so a program aborts on its
own conditions, for example the other edits once one fails:

```js
const controller = new AbortController();
await Promise.allSettled(
  tasks.map((task) =>
    task
      .edit('Replace "Q3" with "Q4" in the "Timeline" section.', {
        signal: controller.signal,
      })
      .catch((error) => {
        controller.abort();
        throw error;
      }),
  ),
);
```

- **What cancels.** The SDK aborts its request to DSS; DSS drops its call to
  the worker; the worker's request signal (`enable_request_signal`) stops the
  models, the op queue and the sync session, as `EditDocument`'s turn Stop does
  today. The promise rejects with a `DOMException` named `AbortError`. A signal
  already aborted rejects before anything is sent. A sandbox killed at its
  deadline cancels the same way.
- **What the document keeps.** The worker applies an edit op by op as the models
  produce them and pushes each op, or each typing step when it animates, to
  sync-service as it lands. There is no rollback: what was sent before the
  abort stays and collaborators see it; nothing is applied after it, because
  the queue checks the signal before each op and typing step. So an aborted
  edit can be left part done (a section rewritten and its list not yet added),
  and the op being typed at that moment can be left partway, since `setText`
  removes the old text before typing the new. Read the document to see what
  landed; never replay the instructions blindly.
- **Structured batches** (`applyEdits`) also take `signal`: aborted before DSS
  forwards the batch, nothing applies; once the worker has started the all-or-
  nothing commit, the batch either lands whole or not at all, and the outcome
  is unknown to the caller (`EditOutcomeUnknownError` semantics: read first).

Per type, all with the same shape (`edit(instructions, { signal })` returning
the new revision, or the new document for `saveAs`, and `webUrl`):

| Type | Method | Server pipeline | Abort |
| --- | --- | --- | --- |
| Markdown, tasks | `doc.edit` | `EditDocument`'s (exists) | Yes, op by op; no rollback (above) |
| Canvas | `canvas.edit` | `EditCanvas`'s (exists) | Yes; each acknowledged step stays |
| Spreadsheet | `sheet.edit` | New: one writer model | Yes until the commit; one commit |
| Word | `wordDoc.edit` | New: one writer model | Yes until the commit; one commit |
| PowerPoint | `deck.edit` (with `saveAs` for a new deck) | New: one writer model | Yes until the save; one version |

**Spreadsheets, Word and PowerPoint have no AI edit pipeline on the server
today.** `EditSpreadsheet`, `EditWordDocument` and `EditPresentation` take op
arrays that the *calling* agent writes; the server only validates and commits
them. So each of these PRs adds a small writer: a worker (or, for PowerPoint,
`crates/documents`) endpoint that reads the content in the format the tool's
read returns, asks one model for ops in the tool's own op schema (the tool
description is the prompt), and commits them through the existing engine with
the same revision checks. Each commits once, so an abort before the commit
changes nothing and after it is too late to stop. AI admission and billing
apply, as for `doc.edit`.

### Lower layer: structured operations (markdown and canvas)

Structured operations are deterministic: no model, no AI cost, exact. In this
stack they exist only for markdown and canvas, for edits that instructions
describe poorly:

- placing a saved question at a known block:
  `doc.insertDatabaseQuery(afterBlockId, savedQuery)`;
- restyling a database answer or chart, or pointing an embedded database at
  another table or view (#9333's `setDatabaseQueryView`, `setDatabaseLocation`);
- mechanical, repeatable edits a program computes: check off list items, set
  table cells, rename a term in given blocks.

```js
const structure = await doc.structure();   // XML with durable node ids
await structure.applyEdits((editor) => {
  editor.setChecked('li4', true);
  editor.setDatabaseQueryView('a9Lm', { displayMode: 'pie', title: 'Share' });
  editor.setDatabaseLocation('c2Xw', { table: accounts });
});
```

- **Reads** return the format the matching tool reads: markdown's XML view
  (`toXml`, node ids as attributes) and the canvas scene with its revision.
- **Revisions and conflicts** follow each engine, as typed SDK errors:
  - Markdown merges with concurrent edits. A batch is all or nothing:
    the worker applies it to a scratch copy of the live state first, and if any
    op fails (a node someone deleted, text no longer found) nothing is committed
    and `DocumentEditRejectedError` lists each failed op.
  - Canvases carry `expectedRevision` from the read and raise
    `RevisionConflictError`, after rebasing unrelated concurrent edits.
  - A lost acknowledgement raises `EditOutcomeUnknownError` ("may have applied;
    read before retrying").
- **Handles take handles.** Builder methods accept `SavedQuery`, `DatabaseTable`
  and `DatabaseView` handles (structurally: `{ toBlock() }`, `{ id }`), so the
  vendored code stays free of SDK types and the model-facing sandbox keeps
  passing strings.

Typed handles for the other types refuse the wrong file type and each has
`webUrl()`. Spreadsheets have one: `macro.documents.spreadsheet(document)`
returns a `Spreadsheet` (a namespace method, because a `Document` method
returning a `Document` subclass would be a circular import), and
`documents.createSpreadsheet()` joins `createCanvas()`.

### Structured editing for spreadsheets; later option for Word and PowerPoint

Spreadsheets get the structured layer in their PR, without vendoring: the
spreadsheet ops are already serde types in `crates/documents`, so DSS
publishes them in its OpenAPI and the SDK's generated client types them.
`Spreadsheet.read()`, `calculate()` and `applyEdits(ops, { expectedRevision })`
are `ReadSpreadsheet`, `CalculateSpreadsheet` and `EditSpreadsheet` over HTTP,
on the same `SpreadsheetService`, with `RevisionConflictError` for a stale
revision and `EditOutcomeUnknownError` for a lost acknowledgement.

A typed lower layer for Word and PowerPoint (their op types, `pptx_engine`
`EditOp` types generated from its schema, reads in the tools' formats,
`expectedRevision` conflicts, and a PowerPoint version check replacing today's
last-writer-wins) can follow if programs need exact paragraph or shape edits
without a model.

## Hiding the direct tools

`covered_by_code_sdk` (`crates/agent_code_mode/src/domain/service.rs`) lists the
tools a code-mode session doesn't see because the SDK covers them. Each PR adds
its tool there once its SDK method lands: `EditDocument` with `doc.edit`,
`EditSpreadsheet`/`ReadSpreadsheet`/`CalculateSpreadsheet`, the Word and
PowerPoint tools, and the canvas tools. Hosts without code mode keep the tools
until they move.

## How vendoring works

The vendored library is only the structured layer's builders; instruction
edits need nothing in the sandbox. In this stack that is one builder:

| Builder | Why instructions don't cover it |
| --- | --- |
| `DocumentEditor` and `DocumentOp` | Deterministic markdown edits and database blocks (above) |

Canvas needs no vendored builder: `canvas.apply(code, { expectedRevision })`
sends CanvasEditor code that the worker runs in its QuickJS sandbox, exactly as
`ApplyCanvasEdits` does. The one engine validates, measures and commits it, so
the SDK and the tool can't drift and no op vocabulary needs versioning.

Spreadsheet, Word and PowerPoint types are deferred with their structured
layer (later option, above).

- **The builder lives in a package, not the worker.** The documents PR moves
  `editor/ops.ts`, `document-editor.ts` and `errors.ts` from the worker into
  `packages/editor-ops/src/document/`. The worker, its QuickJS sandbox bundle
  (`scripts/generate-sandbox.ts`) and the SDK import it from there.
- **The SDK copies the files in at build time.** `packages/sdk` is a standalone
  package with its own lockfile, its esbuild bundle inlines everything except
  `node:*`, and `tsc` declaration emit is rooted at the package. `bun run
  vendor` copies the listed sources into `packages/sdk/src/vendor/`, rewriting
  workspace imports to the vendored copies; `vendor:check` fails CI when a copy
  is stale. The files have no runtime dependencies, so SDK users get no new npm
  dependencies, and TypeDoc and declaration emit see ordinary package files.
- **Versioning.** The vendored builder and the server engine come from the same
  commit. A program built against an older published SDK still works while the
  op vocabulary only grows. Changing an op's meaning needs a new op kind,
  because the published SDK and the deployed worker can differ.
- **Size.** The builders add about 30 KB unminified to `sdk.mjs` and no WASM.
- **Docs budget.** Each entity index must stay under 16 KiB, 32 KiB per tool
  result, at most 32 topics (30 used). `edit` lives in the `documents` topic.
  `DocumentEditor` gets its own `document-editing` topic so its roughly 100
  methods don't crowd the documents index. Spreadsheet, Word, PowerPoint and
  canvas handles share one `office` topic if they fit, which keeps the count at
  32. Each PR measures its index.

## Documentation

Documentation is the product: the SDK reference is where agents learn these
methods, and the system prompt no longer carries tool-usage guidance. Every new
method documents how to use it in its TSDoc:

- The first sentence states the rule an agent must follow, since the index
  shows only that sentence (at most 160 characters). `edit`'s says it takes
  natural-language instructions.
- `edit` says how to write good instructions (be specific, quote the text to
  change, describe the outcome), what it can and cannot do (it can't run or
  change a saved question's SQL, see comments or history, or edit other
  documents), and has worked examples: rewrite a section, fix formatting, abort
  sibling edits.
- Every structured method has a short worked `@example`: read, edit, and handle
  the conflict error where it has one.
- Each method appears in a code-mode docs topic, checked by the documentation
  tests.

## PR plan

Each PR is small and independently mergeable, adds tests first, documents every
new method as above (the SDK reference, code-mode bundle and documentation are
generated at build time), and adds the direct tool it replaces to
`covered_by_code_sdk`.

1. **This design** (docs only).
2. **Documents and tasks** (MACRO-4588).
   - `doc.edit(instructions, { fast, signal })`: DSS `POST
     /documents/{id}/ai-edit` over `EditDocument`'s domain service; the
     worker's `/edit` returns the revision. Hides `EditDocument`.
   - With #9333: `opts.queries` and the structured layer below.
   - Structured layer: `packages/editor-ops` with the document builder
     (accepting `SavedQuery`, table and view handles); worker `POST
     /document-ops`, model-free and all or nothing; DSS `GET
     /documents/{id}/structure` and `POST /documents/{id}/edits`;
     `Document.structure()`, `DocumentStructure.applyEdits()`,
     `Document.insertDatabaseQuery()`.
   - Tests for round trips, concurrent typing during an edit, aborts, and
     refused edits and batches.
3. **Spreadsheets** (MACRO-4587). `documents.createSpreadsheet()`,
   `documents.spreadsheet(document)` with `read`, `calculate` and
   `applyEdits` over `SpreadsheetService`. Hides `ReadSpreadsheet`,
   `CalculateSpreadsheet` and `EditSpreadsheet`. Then `sheet.edit(instructions,
   { signal })` with a new writer model over the same engine: the worker's
   `/spreadsheet/instructions` reads, calculates and commits one batch, and
   DSS `POST /documents/{id}/spreadsheet/ai-edit` admits and meters it.
4. **PowerPoint and Word** (MACRO-4581, MACRO-4841). Shipped as the
   structured layer first: `Document.readPresentation()`,
   `editPresentation(operations)` and `copyPresentation(name, { operations })`
   over `PresentationService`, and `Document.readWord()` and
   `editWord(operations, { trackChanges })` over `WordDocumentService`'s live
   copy, through DSS `/documents/{id}/presentation` and `/word` routes. The
   operation unions are generated from `pptx_engine::EditOp` and
   `WordDocumentOperation`. The same PR adds the read-only
   `readDesign()`, `readPhotoshop()` and `readIllustrator()`, and hides the
   seven matching tools. An instructions `edit()` with a writer model can
   follow.
5. **Canvases** (MACRO-4584). `document.canvas()` with `scene()` over
   `ReadCanvas`, `apply(code, { expectedRevision })` over `ApplyCanvasEdits`
   (409 conflict and 422 rejection when nothing committed), `edit(instructions,
   { signal })` over `EditCanvas`, and `render()` returning a stored
   `StaticImage`. Hides `ReadCanvas`, `EditCanvas`, `ApplyCanvasEdits` and
   `RenderCanvas`: a program returns `images: [await canvas.render()]` and the
   model sees their pixels with the `ExecuteCode` result.

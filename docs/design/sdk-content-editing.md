# SDK content editing

**Status:** Proposed. Implementation follows the PR plan at the end.

Macro tasks: MACRO-4588 (documents and tasks), MACRO-4587 (spreadsheets),
MACRO-4581 (Word and PowerPoint), MACRO-4584 (canvases), MACRO-4631
(editing documents with Lexical).

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
Deterministic edits are a lower layer, for where instructions are a poor fit:
for documents, a program edits a real Lexical editor and commits it; for
canvases, typed operations.

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
to the hosts in `sdk_hosts()` (DSS, auth, cognition, email and others). Neither
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
doc.lexical()        ──GET  /documents/{id}/lexical──▶ view receipt ──▶ /lexical-state: Lexical
                                                                           JSON + revision
lexical.update(() => …)   headless Lexical + lexical-core nodes, in the sandbox, no network
lexical.commit()     ──POST /documents/{id}/lexical──▶ edit receipt ──▶ /lexical-commit: block
                                                                           diff vs base, all or nothing
```

The Lexical layer runs Lexical, not Loro, in the sandbox. Everything below
about Loro still holds: the program edits a plain editor state, and the
worker's live peer is the only thing that writes Loro.

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
- **Lexical commits** (`lexical.commit`) also take `signal`: aborted before
  the worker starts the commit, nothing applies; after that the commit lands
  whole or not at all, and the outcome is unknown to the caller
  (`EditOutcomeUnknownError`). Retrying the same commit is safe (below).

Per type, all with the same shape (`edit(instructions, { signal })` returning
the new revision, or the new document for `saveAs`, and `webUrl`):

| Type | Method | Server pipeline | Abort |
| --- | --- | --- | --- |
| Markdown, tasks | `doc.edit` | `EditDocument`'s (exists) | Yes, op by op; no rollback (above) |
| Canvas | `canvas.edit` | `EditCanvas`'s (exists) | Yes; one commit, so all or nothing |
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

### Lower layer: edit a document with Lexical

Deterministic edits: no model, no AI cost, exact. A program gets a real Lexical
editor holding the document, edits it with the ordinary Lexical API and our
`packages/lexical-core` nodes, and commits it. Models and developers already
know Lexical, so this replaces the bespoke op vocabulary (`DocumentEditor`,
about 100 methods) the first version of this design proposed for programs.

Uses: check off list items, set table cells, rename a term, restructure a
section from data a program computed, insert a saved question at a known
block, restyle a database answer or chart.

```js
import { $getRoot } from 'lexical';
import { $isListItemNode, $isTaskListNode } from '@macro-inc/sdk/lexical';

const lexical = await doc.lexical();
lexical.update(() => {
  for (const block of $getRoot().getChildren()) {
    if (!$isTaskListNode(block)) continue;
    for (const item of block.getChildren()) {
      if ($isListItemNode(item)) item.setChecked(true);
    }
  }
});
await lexical.commit();
```

#### The handle

- `doc.lexical()` returns a `DocumentLexical` with:
  - `editor`: a headless `LexicalEditor` with every `SupportedNodeTypes` node and
    `NodeReplacements` registered, and the document loaded. Anything Lexical
    does headless works (`registerNodeTransform`, `parseEditorState`,
    `$convertFromMarkdownString`).
  - `update(fn)` and `read(fn)`: `editor.update(fn, { discrete: true })` and
    `editor.read(fn)`, so a change is in the state when `update` returns.
  - `commit({ signal })`: sends the change (below).
  - `revision`: the base revision, the document version the state was read at.
- Programs import `lexical` and `@macro-inc/sdk/lexical` and use them
  directly; there is no wrapper DSL. `@macro-inc/sdk/lexical` is a curated
  entry of `packages/lexical-core` (`lexical-core/sdk.ts`): the node classes and
  their `$create…`/`$is…` helpers, the `@lexical/*` nodes and helpers our
  documents use (lists, headings, quotes, links, tables, code, marks),
  `$getId`, and the markdown transformers, so
  `$convertFromMarkdownString(md, ALL_TRANSFORMERS)` builds blocks from markdown.
  The same specifier works in code mode and for npm users.
- Lexical's `$` functions work only against the module instance that owns the
  editor, so the program and the SDK share one copy of `lexical` (bundle plan
  below).
- Not available headless: anything that needs a DOM (`$generateHtmlFromNodes`,
  `exportDOM`). The spike found nothing else that breaks.

#### Reading

DSS `GET /documents/{id}/lexical` (view receipt, view-level document token)
calls the worker's `POST /lexical-state`. The worker joins sync-service as its
editing sessions do (initial sync into a `LoroManager` with
`MARKDOWN_LORO_SCHEMA`), and returns `{ state, revision }`: the mirror's state
normalized through a headless editor (`parseEditorState(…).toJSON()`), and the
base64 oplog version vector (`revision.ts`, as `doc.edit` returns). Both come
from the same Loro state, so they always agree. The worker owns this
conversion because it owns the Loro mirror; lexical-service's `/raw` read
carries no revision.

#### Committing

The SDK diffs the edited state against the base state it read, keyed by
durable node id, at the level of **top-level blocks**, and sends only the
change:

```
POST /documents/{id}/lexical
{ revision, blocks: [{ id, after: <previous block id | null>, node }], removed: [id, …] }
```

`blocks` holds every top-level block that is new, changed, or moved, in
document order; `node` is its serialized Lexical JSON (ids included) and
`after` places it. Blocks the program left alone are not sent. Before
diffing, the SDK gives every node without an id a fresh one
(`$updateAllNodeIds`), as the editor does. An empty diff sends nothing:
`commit()` resolves with the handle's own revision and leaves its base as it
is, which may be behind the document.

The worker joins as a live peer through `EditingWorkspace` (as `/edit` does)
and builds three trees, each normalized through the same headless editor so
they compare structurally:

- **base**: rebuilt from Loro at the revision
  (`doc.forkAt(doc.vvToFrontiers(revision))`, through the mirror). The worker
  never trusts a base sent by the client.
- **live**: the session's current state.
- **wanted**: base with the request's blocks placed and its removals applied.

#### Merge rules

The worker merges the three trees recursively, node by node, keyed by id. A
node is **atomic** (compared whole) unless it is a container: the root, a
list, a table, a table row or a table cell, or a list item whose children are
all lists (a nested list's holder). So a paragraph, a heading or a list item's
text is one unit, and two people editing different items of the same list, or
different cells of a table, merge.

For each atomic node, and for each container's own attributes (everything but
its children), with base `B`, live `L` and wanted `W`:

| Case | Result |
| --- | --- |
| `W = B` | `L`: the program didn't touch it |
| `L = B` | `W`: nobody else touched it |
| `L = W` | `L`: already applied (a retry, or the same edit by someone else) |
| otherwise | **conflict** (`changed`) |

For a container's children, by id:

| In base | In live | Wanted | Result |
| --- | --- | --- | --- |
| yes | yes | yes | merge recursively |
| yes | yes | no | removed if `L = B`, else conflict (`changed`) |
| yes | no | yes | stays removed if `W = B`, else conflict (`removed`) |
| no | yes | no | kept: someone else inserted it |
| no | no | yes | inserted |
| no | yes | yes | kept if `L = W`, else conflict (`changed`) |

**Order.** A child *moved* by one side is one outside the longest common
subsequence of the base and that side's sibling order. The merged order starts
from the live order; each child the program moved or inserted is then placed
after its nearest wanted predecessor that is in the result (first if none).
A child moved by both sides to different predecessors is a conflict
(`moved`). So concurrent moves of the same block never silently overwrite one
another.

- A **conflict** rejects the whole commit; nothing is applied. The response
  lists each node and why (`changed`, `removed` or `moved`). The SDK raises
  `DocumentEditConflictError` with them; the program reads again with
  `doc.lexical()` and redoes its edit.
- **A revision the worker can't rebuild** (not a version of this document) is
  a conflict with reason `revision` and no node.
- **Nodes the program didn't touch are never written.** A collaborator typing
  in any other block merges as usual, before, during and after the commit.
- **Application** is one discrete update of the live session to the merged
  tree, with no await between reading live and applying, so no remote edit can
  slip in between. It is then propagated once, which diffs it into Loro keyed
  by id, the WAL is flushed, and the worker waits for sync-service's
  acknowledgement. A missing acknowledgement is `EditOutcomeUnknownError`.
- **Retry safety** follows from the rules: retrying a commit whose first
  attempt landed finds every node already equal to what it wants and applies
  nothing. No idempotency key or server state is needed.
- **Abort**: the worker checks the request signal before applying; aborted
  there, nothing applies. After that the commit lands whole or not at all.
- **Validation** (422, nothing applied): unknown node types, malformed JSON,
  duplicate ids, a `node` whose id differs from its entry, more than 500
  blocks.
- **Result**: `{ revision, webUrl }`. The handle adopts the merged live state
  and revision the worker returns as its new base, so a program can update and
  commit again without reading.

#### What happens to the structured-operations layer

The first version of this design proposed a structured layer (branch
`wolf/sdk-document-edits`, never merged): `packages/editor-ops`, a vendored
`DocumentEditor`, `doc.structure()`, `structure.applyEdits()`, DSS
`GET /structure` and `POST /edits`, and worker `/document-ops`. The Lexical
layer replaces it for markdown:

- **Kept**: its worker skeleton (live peer via `EditingWorkspace`, all or
  nothing in one update, WAL flush and acknowledgement, `UnacknowledgedError`
  → 502), as `/lexical-commit`; DSS's edit-token minting and outcome mapping;
  its concurrent-typing tests; `EditOutcomeUnknownError`.
- **Dropped**: the op vocabulary in the SDK, `packages/editor-ops`'s document
  half and its vendoring, `doc.structure()` and its XML read,
  `structure.applyEdits()`, `DocumentEditRejectedError` (replaced by
  `DocumentEditConflictError`), and `doc.insertDatabaseQuery()` (a program
  inserts a `DatabaseQueryNode` itself). `DocumentEditor` stays in the worker,
  where models write ops through it.

Canvases keep the structured layer: `CanvasEditor` ops against
`expectedRevision`, raising `RevisionConflictError` after rebasing unrelated
concurrent edits, in the canvas PR.

### Later option: structured editing for spreadsheets, Word and PowerPoint

Not part of this stack. A typed lower layer like canvas's (vendored
spreadsheet and Word op types, `pptx_engine` `EditOp` types generated from its
schema, reads in the tools' formats, `expectedRevision` conflicts, and a
PowerPoint version check replacing today's last-writer-wins) can follow if
programs need exact cell, paragraph or shape edits without a model.

## Hiding the direct tools

`covered_by_code_sdk` (`crates/agent_code_mode/src/domain/service.rs`) lists the
tools a code-mode session doesn't see because the SDK covers them. Each PR adds
its tool there once its SDK method lands: `EditDocument` with `doc.edit`,
`EditSpreadsheet`/`ReadSpreadsheet`/`CalculateSpreadsheet`, the Word and
PowerPoint tools, and the canvas tools. Hosts without code mode keep the tools
until they move.

## How Lexical reaches programs

Instruction edits need nothing in the sandbox. The Lexical layer needs
`lexical`, the `@lexical/*` packages lexical-core uses, and
`packages/lexical-core` itself, as ordinary JavaScript: no WASM.

### Spike results

Lexical core nodes, `NodeReplacements`, `nodeIdPlugin` and the markdown
transformers, bundled as code mode bundles the SDK and run under the exact
sandbox flags (`--deny-import --deny-net`, scratch-only reads, 128 MiB, the
bootstrap's timer ban):

- Everything works. Discrete updates and the default microtask commit both
  run, since neither needs a timer.
- Loading the bundle takes about 90 ms. Markdown to state, an update, and
  markdown out take about 30 ms for a small document. The heap is 11 MB.
- **Size**: 810 KB minified (235 KB gzipped), against `sdk.mjs`'s 377 KB.
  320 KB of it is `zod`, used by one table transformer
  (`transformers/tables.ts`) for two number checks; replaced by plain checks,
  the bundle is **580 KB** (184 KB gzipped). Next largest: `lexical` 150 KB,
  lexical-core nodes 75 KB, `@lexical/table` 61 KB, `prismjs` 55 KB (pulled in
  by `CustomCodeNode`).
- Nothing DOM-only breaks: node `createDOM`/`exportDOM` touch `document` only
  when called, and headless never calls them.

### One entry: `@macro-inc/sdk/lexical`

- `packages/lexical-core/sdk.ts` is the curated entry: the nodes,
  `$create…`/`$is…` helpers, `NodeReplacements`, `SupportedNodeTypes`, `$getId`,
  the transformers, and re-exports of the `@lexical/*` names our documents use.
  It excludes the package index's AI and diff utilities.
- `packages/sdk` vendors it: `bun run vendor` copies the entry and the files it
  imports into `src/vendor/lexical-core/`, and `vendor:check` (run by the SDK's
  checks) fails when a copy is stale. The SDK exports it as the
  `@macro-inc/sdk/lexical` subpath, and `doc.lexical()` loads it with a dynamic
  `import()`, so the SDK's main entry stays the size it is.
- `lexical` and the `@lexical/*` packages are optional peer dependencies of
  `@macro-inc/sdk`, pinned to the version lexical-core uses, so an npm
  program's `lexical` import is the SDK's. Only `doc.lexical()` needs them; it
  fails with a message naming them when they are missing. lexical-core's own
  runtime dependencies (`nanoid`, `linkify-it`, `prismjs`) become SDK
  dependencies.

### Code mode: a separate, lazily loaded chunk

- `packages/code-mode-sdk` builds, at build time with the rest of the bundle
  (`crates/code_mode_assets`), code-split modules for `lexical`, the
  `@lexical/*` packages and `@macro-inc/sdk/lexical`, beside `sdk.mjs`.
  `crates/code_execution` writes them to the run's root and maps each
  specifier in `imports.json`.
- `sdk.mjs` keeps those specifiers external, so `doc.lexical()` imports them
  through the same import map a program's `import { $getRoot } from 'lexical'`
  uses: one module instance, as Lexical's `$` functions require.
- Runs that never edit pay only the file write, not the parse and compile.

### Versioning

The committed JSON is Lexical's serialized form of our nodes. The worker
rejects a commit whose node types or versions it doesn't know, naming them,
rather than writing nodes the app can't render. Node JSON changes therefore
follow the app's rule for persisted documents already: old JSON keeps loading.
A program built against an older SDK keeps working while nodes only add
optional fields.

### Docs budget

Each entity index must stay under 16 KiB, 32 KiB per tool result, at most 32
topics (30 used). `edit` and `lexical()` live in the `documents` topic. A
`DocumentLexical` documents the node types with their `$create…` helpers,
the transformers, and the merge and conflict rules in its TSDoc; the Lexical
API itself is not re-documented. Spreadsheet, Word, PowerPoint and
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
- `lexical()` and `commit()` have short worked `@example`s: read, update,
  commit, and handle `DocumentEditConflictError` by reading again.
- Each method appears in a code-mode docs topic, checked by the documentation
  tests.

## PR plan

Each PR is small and independently mergeable, adds tests first, documents every
new method as above (the SDK reference, code-mode bundle and documentation are
generated at build time), and adds the direct tool it replaces to
`covered_by_code_sdk`.

1. **This design** (docs only, #9404).
2. **Documents and tasks** (MACRO-4588).
   - `doc.edit(instructions, { fast, signal })`: DSS `POST
     /documents/{id}/ai-edit` over `EditDocument`'s domain service; the
     worker's `/edit` returns the revision. Hides `EditDocument`.
   - With #9333: `opts.queries`.
   - Tests for round trips, concurrent typing during an edit, aborts, and
     refused edits.
3. **Documents with Lexical** (MACRO-4631), stacked PRs, tests first:
   1. This design's Lexical layer, and lexical-core: `zod` replaced in
      `transformers/tables.ts`, the curated `sdk.ts` entry.
   2. Worker `/lexical-state` and `/lexical-commit`: every row of the merge
      tables, concurrent moves, a human typing in the same block and in
      another block during a commit, a retry after a lost acknowledgement, an
      abort before the commit starts, unknown node types, an unreadable
      revision.
   3. DSS `GET` and `POST /documents/{id}/lexical`: receipts, document tokens,
      outcome mapping (409 conflict, 422 invalid, 502 unknown), spans.
   4. SDK `Document.lexical()`, `DocumentLexical`, the block diff,
      `DocumentEditConflictError`, the vendored `@macro-inc/sdk/lexical` entry
      and optional `lexical` peers; the code-mode chunks and import map, with a
      Deno test that edits a document under the sandbox flags.
4. **Spreadsheets** (MACRO-4587). `sheet.edit(instructions, { signal })` with a
   new writer model over `SpreadsheetService`; changed ranges and the new
   revision; `documents.createSpreadsheet()`. Hides `EditSpreadsheet`.
5. **PowerPoint** (MACRO-4581). `deck.edit(instructions, { signal, saveAs })`
   with a new writer model over `PresentationService`; changed slides, the new
   version or the new `Presentation` for `saveAs`. Hides `EditPresentation`.
6. **Word** (MACRO-4581). `wordDoc.edit(instructions, { signal })` with a new
   writer model over `WordDocumentService`; changed paragraph ids. Hides
   `EditWordDocument`.
7. **Canvases** (MACRO-4584). `canvas.edit(instructions, { signal })` over
   `EditCanvas`; the structured layer (`CanvasEditor` in `packages/editor-ops`,
   ops with `expectedRevision`) and render. Hides `EditCanvas` and
   `ApplyCanvasEdits`.

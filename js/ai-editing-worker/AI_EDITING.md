# AI editing

This worker takes a plain-English request like "tighten the intro and turn the
risks section into a table" and applies it to a live collaborative document —
the same document a human is editing in the browser, over the same sync channel,
with a cursor that visibly moves and types. It is a Cloudflare Worker that, for
the duration of one request, behaves like another person who has the doc open.

That last part is the thing to internalize before reading further: the worker
does not compute a diff and POST it somewhere. It joins the document as a real
Loro peer, makes its edits through the same CRDT everyone else is editing, and
streams them out keystroke by keystroke. A lot of the machinery here exists to
make that work — and look human — from a headless server instead of a browser tab.

## The request

Everything starts at `POST /edit` (`src/endpoints/edit.ts`). The body carries a
user token, a document id, the prompt, and a few knobs (`interpret`,
`typingAnimations`, `debug`, and optional per-role model overrides). The handler
swaps the user token for a short-lived document token against the document
service, builds the sync-service WebSocket URL from it, and hands everything to
`runEditSession` (`src/run-edit.ts`).

Models are resolved per role from three providers (Anthropic, Cerebras, OpenAI).
The defaults are deliberately mixed: a fast Haiku drives the supervisor loop,
Sonnet does the one-shot interpretation pass, and a Cerebras model writes the
edit code because that step is the hot loop and raw tokens-per-second matters
more than polish there. Any of the three can be overridden in the request.

## Joining the document

`runEditSession` is the spine. It:

1. Opens a `WorkerSyncSource` (`src/sync-source.ts`) — a `LiveSyncSource` over
   the sync-service WebSocket, speaking the same Bebop wire protocol as the
   browser client. It's a trimmed-down version of the browser source: no
   reconnect/backoff (a worker request is short and online the whole time) and
   no Solid signals, but the same handshake, so the worker runs the *exact* sync
   loop a browser would rather than hand-rolling state writes. Events that arrive
   before the engine attaches its listener are buffered and flushed on `listen()`.
2. Waits for the initial snapshot, then spins up a `LoroManager` + `SyncEngine`
   (borrowed from the app's collab core) around the markdown Loro schema. The
   manager owns the one true merged doc and its mirror. State changes are pushed
   to the engine on a microtask, not inline: Loro fires the mirror subscriber
   synchronously during `importUpdate`, and the engine guards remote handling
   with a mutex, so calling it inline would re-enter that lock. (The browser gets
   this deferral for free through a Solid effect; here it's done by hand.)
3. Builds an in-memory Lexical editing session (`createEditingSession`) seeded
   from the merged state. This is the AI's editing surface — a real Lexical
   editor, headless.
4. Wires a `WALSyncer` so local commits get pushed back to the server, and
   flushes it before disconnecting.

The engine has one binding that matters here, `onRemoteState`: when a remote
(human) edit lands mid-session, it reloads that state into the AI's Lexical
session. Combined with the propagate discipline below, this is what lets a person
keep typing while the AI works without either side clobbering the other.

### propagate

The bridge between "the AI changed the Lexical session" and "everyone sees it"
is `propagate`. After every applied edit it commits the Loro doc, serializes the
current Lexical state to a snapshot, and syncs that snapshot into Loro through
the engine. Three details make it correct:

- **Serialized on a promise chain.** The animation executor calls `propagate`
  synchronously between steps; chaining the actual work guarantees one
  propagation completes before the next begins.
- **Snapshots inside the chained task**, not at call time, so it folds in any
  remote edit that reconciled in the meantime — the AI's change becomes a clean
  delta on top of the user's text rather than overwriting it.
- **Switches to a fresh AI peer id before the commit** (see *Identity* below), so
  each batch is attributed to a recognizable author.

## The agents

The "intelligence" is three roles, described to the models in
`src/ai-editing/prompts/`:

- **Interpreter** (`agents/interpreter.ts`, `INTERPRET.md`) — an optional first
  pass that reads the request against the document and writes down *intent*: the
  literal ask, the underlying goal, and the concrete end state as literal text.
  It doesn't plan edits or touch anything; it exists so the supervisor acts on
  "what the user actually wants" rather than a literal reading. This is where
  "fill in the blank cell" becomes the real value that belongs there instead of
  "N/A".
- **Supervisor** (`agents/supervisor.ts`, `SUPERVISOR.md`) — the orchestrator,
  capped at 12 steps. It turns the intent into small mechanical edit instructions
  and dispatches them to writers in rounds, reviewing the resulting document
  after each round until it judges the request done. It never writes edit code
  itself; it describes changes and hands over verbatim text via `snippets`. It
  also has tools to look up people (for mentions) and documents (for doc cards).
- **Writer / coder** (`agents/coder.ts`, `CODER.md`) — receives one instruction
  and a narrow window of the document, and carries it out by writing plain
  JavaScript against a single `editor` object. Mechanical only. Capped at 7 steps
  or until it calls `reportBlocked` — which it does, instead of guessing, when
  its context window is too narrow to see what it needs.

The supervisor dispatches via the `dispatch` tool (`tools/dispatch.ts`), which
can run several writers **in parallel** in one batch — but only across disjoint
regions, since they all edit one shared session. `dispatch` also computes the
context window each writer sees: it scans the instruction for referenced ids and
expands them to their containing block/section, so a writer gets just the
relevant slice of XML rather than the whole document. Each writer borrows its own
identity (name + color) from a `PeerPool` for the duration of its task, so
concurrent writers show up as distinct cursors and never collide.

## From a JS snippet to a keystroke

The writer's one tool is `runCode(code)`. Here is the full path that string
takes, which is the core of the system:

```
 model writes JS  →  QuickJS sandbox  →  DocumentEditor  →  DocumentOp[]
                                                                 │
                              ┌──────────────────────────────────┘
                              ▼
                   animate(op)  →  DocumentOpStep[]   (cursor / pause / edit)
                              │
                  runQueue replays each step:
                    pause → sleep   awareness → cursor   edit → Doc.apply
                              │
        Lexical session  ←────┘
                │
            propagate  →  snapshot  →  mirror  →  Loro  →  sync to everyone
```

### The sandbox (QuickJS)

The model writes arbitrary JavaScript and we have to run it, but it must never
touch the host, the network, or the filesystem. `src/sandbox.ts` runs it in a
QuickJS WASM interpreter — a complete, isolated JS engine with nothing in scope
but the two values we hand it: `editor` and `snippets`. No imports, no `fetch`,
no host globals.

The mechanics per run:

1. A fresh QuickJS context is created. (The WASM module itself is built once and
   cached — and built through `newVariant(releaseSync, { wasmModule })` because
   Cloudflare Workers can't compile a WASM module from raw binary at runtime, so
   we override how Emscripten obtains it.)
2. We eval the `SANDBOX_CODE` bundle, then construct
   `new DocumentEditor({ validIds, refs })` and define `snippets`.
3. We eval the model's snippet.
4. We eval `JSON.stringify(editor.drain())`, dump the JSON across the WASM
   boundary, and `JSON.parse` it back on the host into `DocumentOp[]`.
5. The context is always disposed in `finally`.

`SANDBOX_CODE` is generated, not hand-written: `scripts/generate-sandbox.ts`
transpiles `editor/errors.ts` and `editor/document-editor.ts` to plain JS with
Bun's transpiler, strips the `import`/`export` keywords (QuickJS evaluates a
plain script, not an ES module), and writes the result as a JSON string literal
into `src/editor-sandbox-code.ts`. This is wired into `prebuild` and `dev`. **If
you change `DocumentEditor`, regenerate the bundle** or the AI's editor surface
won't reflect your edit — there's a loud comment to that effect at the top of
both files.

One subtlety worth calling out: QuickJS has no good entropy, so the *host* mints
the ids for inserted nodes. Each run pre-generates a pool of 128 unique ids
(`REF_POOL_SIZE`) and passes them in; every creator method pops one and stamps it
as the new node's durable id. That's why inserted ids never collide across
concurrent writers, repeated runs, or sessions — and why "too many inserts in one
snippet" is a real, if rare, error.

### DocumentEditor and the op vocabulary

`DocumentEditor` (`editor/document-editor.ts`) is the ergonomic, chainable surface
the model calls — `bold`, `convertToHeading`, `insertTableAfter`, `mentionUser`,
and so on. It does two jobs: validate, and lower. Every id is checked against the
set the model was shown (`requireId` throws an error *naming* the bad id, which
the model gets back and can retry); creator methods mint a `Ref` placeholder and
return it so later calls can address a node that doesn't exist yet. Everything
collapses onto one flat vocabulary of `DocumentOp` (`editor/ops.ts`) — plain data
that imports nothing from Lexical. That cleanliness is deliberate: it's what lets
the ops cross the WASM boundary as JSON and lets the whole pipeline be tested
without a real editor.

### The animation framework

This is the part that makes the AI look like a person typing rather than a patch
landing. The guiding idea: **animation intent is declared by the op, not inferred
from a diff.** Each `DocumentOp` kind has exactly one animator, in
`queue/animators.ts`, and `animate(op, ctx)` dispatches on the kind to produce a
flat list of `DocumentOpStep`s. There are only three kinds of step:

- `awareness` — move the cursor or set a selection (broadcast only; never mutates)
- `edit` — apply a real `DocumentOp` to the document
- `pause` — sleep for some milliseconds

A handful of primitives compose into every animation:

- **`sweepSelect`** — drag-select a span the way a hand does: land the caret on
  one end (direction biased 60/40 toward the left), rest a beat, then grow the
  highlight to the full span over 0–5 incremental "sweeps", then settle. Crucially
  the selection is awareness-only and reads against the *unmutated* text, so the
  offsets stay valid no matter what the edit does afterward.
- **`typeText`** — emit the text three characters at a time (`TYPE_CHUNK`), cursor
  trailing each chunk, with a per-chunk pause of `msPerChar × length × jitter`.
- **`retype`** — select all, hesitate, delete, then type the new content (this is
  what `setText` and table-cell edits look like).
- **`focus` / `insertLead`** — for structural ops, move the caret to the relevant
  spot and pause, so a block "appears where the caret is".

The per-op choices are where the human texture comes from, and they're worth
skimming in `animate()`:

- **Deleting** a block selects the whole thing, then takes a long
  `preDeletePause` before removing it — destroying content reads as deliberate.
- **Moving** a block selects it first, so you see *what* is about to move.
- **Merging** highlights each block in turn before combining them.
- **A divider** is drafted as literal `---` typed into a throwaway paragraph, a
  beat, then swapped for the real horizontal rule — mimicking the markdown
  shortcut a person would use.
- **A list** is built item by item: insert an empty list, then for each item
  append an empty list item (the simulated Enter) and type into it.
- **Inline format / link / highlight** sweep-select *each* matched occurrence in
  turn, then apply one match-based edit.

Speed is a single knob. `runQueue` computes `msPerChar = 60000 / (speed × 5)`
(treating `speed` as a words-per-minute-ish rate at 5 chars/word; default 800),
and all the pause and jitter ranges live declaratively in `queue/types.ts`
(`DEFAULT_RANGES`).

All nondeterminism flows through one seam, `RandomSource` (`queue/random-source.ts`):
selection direction, pause jitter, and sweep counts. The real source is backed by
random-js (unbiased, rejection-sampled). The mock replays a fixed sequence, which
makes an entire animation reproducible and assertable — the reason the animator
tests can check exact step sequences.

### The executor

`runQueue` (`queue/runner.ts`) ties it together. For each op it calls `animate`
to get the steps, then replays them: `pause` → sleep, `awareness` → push to the
`AwarenessSource`, `edit` → `docWriter.apply`. Two things to note. First, a
`resolveNode` hook maps a ref placeholder to its real id once the insert that
created it has run, so a cursor can point at a just-inserted node. Second, errors
are contained per op — if an animator or an apply throws, that op is recorded as a
failure and the loop continues; only the failures are summarized back to the model
(success produces no noise). When `typingAnimations` is off, this whole layer is
bypassed and the ops apply directly (`src/ai-editing/runtime.ts`).

### Doc — the one Lexical-touching layer

`Doc` (`doc/doc.ts`) is the only place in the system that touches real Lexical. It
implements the two narrow interfaces in `doc/interfaces.ts`: `DocReader` (used by
animators to plan — locate match offsets, measure text length, resolve a table
cell) and `DocWriter` (used by the executor to apply). The planner only ever gets
the reader, so it can read to plan but never mutate; tests substitute mocks of
both with no editor at all.

Each `apply` runs as a discrete Lexical update, delegating the actual mutation to
the existing `ai-toolkit` `$`-helpers (`ai-toolkit/blocks`, `inline`, `lists`,
`tables`, …) resolved by node id. On any error it rolls the editor state back,
re-stamps node ids, and surfaces a clean `EditError`; on success it calls
`propagate`, which is what streams the change out.

## Identity: cursors and peer ids

There are two distinct notions of "who" here, and they're easy to conflate.

**The live cursor** is ephemeral. While a writer works, `realAwarenessSource`
(`awareness/awareness-source.ts`) encodes its caret/selection as a Loro cursor and
broadcasts it over the ephemeral awareness channel, so the website renders a
remote cursor walking through the text. Each writer draws a name from a pool
(`Sam (AI)`, `Alex (AI)`, …) and one of a few accent colors; the cursor lingers
~700ms after the writer finishes, then clears. Resolving a block id to the
`LoroText` that actually owns the characters is fiddly (a block's text lives in a
child text container), which is most of what that file does.

**The peer id** is durable — it's stamped into Loro history on every commit. Human
peers get a random id across the full 64-bit space; AI commits are attributed to
ids from a small **reserved block** (`awareness/ai-peer.ts`): the top of the
decimal range, `999999999999999000` through `999999999999999999`. Two reasons.
First, recognition — a history viewer can flag AI authorship by range (`isAiPeer`)
and, because the ids are visibly "all nines" in decimal, you can spot them by eye
in a debugger. Second, they're handed out by a plain incrementing counter rather
than randomly, because the only invariant that matters is that two writers editing
at once never share an id; with the writer pool capped well below the block size,
sequential hand-out guarantees that without needing entropy.

## Determinism and testing

A recurring theme worth noticing: the system is built so the interesting parts are
pure and testable without a browser, a model, or a network.

- `DocumentOp`s are plain data, so `DocumentEditor` can be exercised directly.
- Animators are pure functions of `(op, DocReader, RandomSource)`; a mock random
  source replays a fixed sequence, so a full animation is a deterministic,
  assertable list of steps.
- `DocReader`/`DocWriter` are mockable, so the queue runs with no Lexical.
- `runQueue` takes an injectable `sleep`, so tests skip real timers.

The `.test.ts` files next to each module lean on exactly these seams.

## File map

| Path | What it is |
| --- | --- |
| `src/index.ts`, `src/endpoints/` | Hono app and the `POST /edit` route |
| `src/run-edit.ts` | Session spine: sync, agents, propagate, WAL flush |
| `src/sync-source.ts` | Headless `LiveSyncSource` over the sync-service WS |
| `src/sandbox.ts` | QuickJS sandbox the writer's JS runs in |
| `src/editor-sandbox-code.ts` | Generated `DocumentEditor` bundle (do not edit) |
| `scripts/generate-sandbox.ts` | Transpiles `DocumentEditor` into the bundle above |
| `src/ai-editing/agents/` | Interpreter, supervisor, writer/coder |
| `src/ai-editing/prompts/` | Role prompts and the API reference shown to models |
| `src/ai-editing/tools/` | `dispatch`, `runCode`, contact/document search |
| `src/ai-editing/editor/` | `DocumentEditor` surface and the `DocumentOp` vocabulary |
| `src/ai-editing/queue/` | Animators, random source, and the replay runner |
| `src/ai-editing/doc/` | `Doc` (the only Lexical-touching layer) + its interfaces |
| `src/ai-editing/ai-toolkit/` | The `$`-helpers `Doc` delegates real mutations to |
| `src/ai-editing/awareness/` | Live cursors, the writer name pool, AI peer ids |

## Running it locally

`bun run dev` regenerates the sandbox bundle and starts Wrangler against the
`local` environment. Two scripts help with the pieces in isolation:
`scripts/edit.ts` drives a full edit session against a running worker from the CLI
(`<document-id> <prompt>` plus a user token), and `scripts/typer.ts` types random
gibberish into a document so you can watch the animation and sync path without a
model in the loop. And again: if you touch `DocumentEditor`, regenerate the
sandbox first.

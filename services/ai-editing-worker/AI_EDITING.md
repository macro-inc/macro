# AI editing

The general idea is that we have a worker that takes an English request for a
document and dispatches agents to produce edits on the document.

We do this by having a Cloudflare worker join the document as a real Loro peer,
make its edits through the same CRDT system everyone else uses, and stream them
out keystroke by keystroke.

## Shared-code boundary

The worker and web app share the Loro collaboration engine, sync-service wire
transport, and WebSocket runtime through `@macro-inc/collaboration`. Browser
authentication and sync HTTP policy stay in `apps/web`; the package accepts an
environment-specific URL resolver instead. The worker is part of the root Bun
workspace, so the collaboration and Lexical packages resolve one dependency
graph in both runtimes.

# Flow

We have a simple hono Cloudflare worker `POST /edit`. The body carries a
user token, a document id, the prompt, and a few config options (`interpret`,
`typingAnimations`, `debug`, and optional per-role model overrides). The handler
swaps the user token for a short-lived document token against the document
service, builds the sync-service WebSocket URL from it, and hands everything to
`runEditSession` (`src/run-edit.ts`).

## Joining the document

`runEditSession` is the main entrypoint that our edit endpoint calls to start an
edit session. At a high level, it:

1. Opens a sync-service WebSocket, speaking the same Bebop wire protocol as the
   browser client.
2. Waits for the initial snapshot, then spins up a `LoroManager` + `SyncEngine`
   around the markdown Loro schema. It uses the same abstractions the frontend
   does.
3. Wires a `WALSyncer` so local commits get pushed back to the server, and
   flushes it before disconnecting. It's memory backed (not IDB).

## The agents

We're using three agents to carry out our edits:

- **Interpreter**: a first pass that figures out what the user "wants" and
  writes out some goals for the supervisor. Having a thinking step helps the
  supervisor make more "correct" edits for what the user wants.
- **Supervisor**: dispatches coding agents to make small mechanical edits, and
  iterates. Decides when we are done and happy.
- **Writer / coder**: generates code that edits the lexical tree. Uses a custom
  abstraction that we turn into edits for our animation framework, which then
  eventually turns into real lexical edits.

A diagram for the animation abstraction flow

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

### Prompts

System prompts are composed in `ai-editing/prompts/index.ts` from
single-purpose markdown sections: `GROUND_RULES` (the XML view, ids),
`TEAM` (the supervisor/writer split), `EDITING_RULES` (how `runCode` and
`editor` are used), `API_COMPLETE`, and one short role file per agent. A rule
lives in exactly one section; a role file holds only what is specific to that
role. Add to a shared section when two roles need something, not to both role
files.

### Fast mode

`mode: "fast"` on `/edit` skips the interpreter, supervisor, and dispatch
entirely (`ai-editing/agents/fast.ts`). One model (`models.fast`, a fallback
chain like the other roles) gets the user's request and the ENTIRE document as
line-numbered XML, and edits it directly through the same `runCode` /
`readDocument` / `reportBlocked` tools a coder has. Each `runCode` reply is the
effect report, so it sees what it changed and can correct itself; the step cap
is `DEFAULT_MAX_FAST_STEPS`. Everything below `runCode` is unchanged: sandbox,
ops, animation queue, `Doc.apply`, propagation.

It exists for small, well-scoped inline edits where the supervisor's review
loop costs more latency than it buys. The web inline selection popup sends
`mode: "fast"` with `propagate: false`, so the ops come back in the response as
one dump and are applied client-side into the user's undo stack. The whole-doc
edit bar stays on the supervised pipeline. The backend `EditDocument` tool
(chat agents, MCP) exposes it as a `fast` boolean for one quick, contained
edit; its default remains supervised.

### DocumentEditor and ops

`DocumentEditor` is a ergonomic chainable surface the model calls. It has a
million simple small methods like `bold`, `convertToHeading`,
`insertTableAfter`, `mentionUser`. As you use it it accumulates all the ops but
doesn't actually do any mutations on the document. As you create new nodes it
hands out "refs" from a pool of random IDs.

Once the AI writes code that acts on a document editor, we run the code with a
blank `DocumentEditor` in a quickjs sandbox in the worker. That code produces an
accumulated vector of all the document operations we want, which we can then run
on the document directly or propagate via an animator.

For animation, each `DocumentOp` kind has exactly one animator that maps to it,
in, and dispatches on the kind to produce a flat list of `DocumentOpStep`s.
There are only three kinds of steps:

- `awareness`: move the cursor or set a selection
- `edit`: apply a real `DocumentOp` to the document
- `pause`: sleep for some time

We have an abstraction called the "executor" that ties together the animation queue and the document editor. It is what actually "plays" everything.

### "Doc"s

`Doc{Writer/Reader}` is an abstraction over the real Lexical `Document`. This makes everything much more testable. It has a minimal-ish (okay not super minimal) interface that's easy to mock and run against real lexical.

We have a big "ai-toolkit" lexical library that has a bunch of utility functions for working with lexical documents that the real lexical impl of the `DocWriter` uses.

It's `apply` runs as a discrete Lexical update, delegating the actual mutation to
the existing `ai-toolkit` `$`-helpers usually resolved by our durable lexical
node ids. It is what turns DocumentOps into actual edits to the lexical document.

## Cursors and peer ids

**The live cursor** is ephemeral. While a writer works, `realAwarenessSource`
encodes its caret/selection as a Loro cursor and broadcasts it over the
ephemeral awareness channel, so the website renders a remote cursor walking
through the text. The cursor's label is the editor `POST /edit` names
(`editor: { name }`): the agent or persona that asked for the edit, so a
`Macro` or `Grunk` session's edits read `Macro (AI)` / `Grunk (AI)` on every
cursor they draw (`PeerPool.forEditor`). A request that names nobody falls back
to the pool of distinct names (`Sam (AI)`, `Alex (AI)`). Every label ends in
`(AI)`; the website keys off that suffix to keep AI name tags pinned. Each
writer also gets one of a few accent colors; the cursor lingers ~700ms after the
writer finishes, then clears. We have some ugly code that manages resolving a
block id to the `LoroText` that actually owns the characters for this :/

**The peer id** Human peers get random ids from the whole 64b range, and we have
it so that AI commits use a small reserved range in
(`999999999999999000`–`999999999999999999`). This makes Markdown AI authorship easy to
detect (`isAiPeer`) which history can use for grouping. Canvas instead uses
full-width random session IDs and signed actor attribution, as described below.

## Comment marks

`POST /comment-mark` places or removes the comment mark an inline comment is
anchored to (`src/comment-mark`). No model runs: the caller quotes the text and
an optional 1-based occurrence, and the worker joins the document as a peer,
wraps that exact span in a committed `CommentNode`, and pushes it like any other
edit. Text that is missing, crosses from one block into another, or appears
more than once with no occurrence chosen is refused with a 422 and the
document is left untouched, so a mark is never guessed into place. The
backend `CommentOnText` tool places the mark first and then posts the
thread anchored to it, removing the mark again if the post fails.

## Canvas

`POST /canvas` reads an initialized Canvas room or performs a natural-language
edit. Documents' `ReadCanvas`, `RenderCanvas`, `ApplyCanvasEdits` and `EditCanvas` tools authorize native canvas
documents, mint view/edit tokens naming the actor, and apply existing AI
admission and usage metering. The app's **Ask Macro** action in the standalone toolbar and Drive detail header attaches
the canvas to that tool-enabled conversation on desktop and mobile.

The model calls the ergonomic `CanvasEditor` SDK through `runCode`. QuickJS has
no host I/O, a 16 MiB heap, a 512 KiB stack and a one-second execution deadline.
The host mints up to 100 new stable IDs and validates at most 100 operations per
snippet. `scripts/generate-sandbox.ts` generates the sandbox script from
`src/canvas/editor.ts`; wire-operation validation lives in `schema.ts`. Completed model-step usage is
retained on normal failure/timeout responses and recorded before a tool error is
surfaced. As with document AI editing, a hard caller disconnect can prevent the
worker response from reaching the recorder; provider usage for that interrupted
request may be unreported.

The worker uses the shared collaboration manager/engine/WAL and binds the
existing graphics backend to that live Loro document. Before each snippet it
reads the latest merged scene, validates the entire snippet on a disposable
graphics editor, measures changed text in an isolated browser, presents transient awareness
steps, revalidates current target/ancestor/connector/order/region dependencies,
pulls a server update barrier (an ACK can precede live delivery), then makes
one live backend commit. Up to two named writers plan and animate
independent batches concurrently; conflicts wait and stale batches must reread.
Their canonical session serializes final commit/ACK work. New items also reserve
space, so distinct IDs alone do not establish independence. It never replaces the
shared scene or saves the legacy JSON. Canvas uses full-width random peer IDs to avoid cross-isolate collisions; signed
actor claims provide durable attribution. Ephemeral cursor/selection names carry
the requesting editor’s AI label and are cleared on teardown. Successful calls
require an acknowledged WAL flush. A missing acknowledgement is an uncertain
write: abort model execution and reread before retrying intent. Cancellation
can leave earlier acknowledged snippets applied.

Supported commands create rectangles, ellipses, text and bound connectors;
move, resize boxes, style, relabel, group/ungroup, reparent and reorder siblings.
Moves are world-space deltas and reparenting preserves world pose. Text and
labels use the same plain-text-to-Lexical codec as the app. Same-label changes
remain whole-string LWW; independent pose and appearance edits merge. Headless
labels and standalone text are measured by the actual Canvas StaticLexical
renderer, bundled fonts and CSS before committing. `create` defaults to a
320-unit wrapping width. `editor.fitText(id, 'grow', width?)` and
`editor.textStyle(id, {fontSize, fontFamily, fitText})` expose fitting explicitly.
The persistent default `grow` keeps readable requested fonts and increases box
height (and tiny label interiors' width). `contain` explicitly preserves geometry
and permits scaling; `error` rejects overflow. Relabeling, font changes and width
changes remeasure. Ellipses use the core safe interior. Effects return actual
measured dimensions, requested/rendered font sizes, world bounds and overflow.
Measurement is asynchronous: target and region preconditions are revalidated
before any durable write. New
media/document references and deletion of embedded items remain in the host's
authorized asset/reference flow. Existing references can move/resize/style.

`ReadCanvas` returns a bounded live overview with stable IDs, geometry,
containment/order, world bounds and plain text. It reports truncation and
supports stable-ID filtering. Unsupported/uninitialized room formats are
refused. Native creation initializes its winning seed server-side before return;
only legacy imported Canvas JSON requires an initial browser migration.


`RenderCanvas` returns native PNG image content to both the chat agent and the
editing model, with a SHA-256 frozen scene revision, clock, crop and stable-ID
world bounds. `ReadCanvas(format: "overview")` offers a deterministic approximate
semantic graph with an ID legend; precise scene geometry and images remain the
primary representation. Visual requests start with an image and receive a bounded
final image review/correction pass. Simple changes can use the cheaper scene path.
The request allows at most four delegated writers, 200 operations and six images.
Canvas uses a native Anthropic vision-capable chain. The shared document OpenAI
Chat Completions chain is deliberately not reused: that adapter serializes tool
image output to text. Outer native Responses/Anthropic/Gemini adapters retain
image parts; compatible Chat Completions outer models receive an explicit
unsupported-image explanation rather than encoded pixels or a failed next turn.

The read-only `canvas-render.html` bundle uses the real GraphicsSurface,
CanvasTextContent/StaticLexical and fonts, with no collaboration or editing host.
Rendering returns DOM-measured text bounds/overflow and excludes cursors/ghosts.
Only the configured application's static bundle/fonts load; referenced images,
videos and documents are explicit unavailable placeholders rather than fetching
resources with wider credentials. Snapshots are bounded to 2 MB, images to 3 MB,
and output to 1600×1200; crops below the supported camera zoom are rejected.
Production uses the configured Cloudflare BROWSER binding and CANVAS_RENDER_URL;
local CANVAS_BROWSER_URL connects a trusted CDP browser to the same bundle.
These URLs are deployment configuration, never model input. No deployment is
required for local testing. Model image telemetry records only counts and hashes.

## Forms

`POST /forms` accepts a base64 Loro snapshot and a validated target layout, and
returns a binary incremental update. It uses `@macro-inc/collaboration/forms/layout`,
the same codec as the browser builder. This endpoint is a bounded, stateless
transform: it cannot load or save entities and does not launch another model.

The Forms authoring service authorizes the caller, validates the requested
changes and database dependencies, calls this worker, and verifies its delta.
It merges that same delta with fresh live snapshots, validates the merged layout,
and saves through the existing collaboration port with bounded CAS retries.
Human edits therefore merge at the CRDT field/text level. Metadata, database
columns, booking policy and sharing remain with their owning domain services.
No authoring snapshots or execution records are retained separately. Each tool
invocation is independent; after a timeout, inspect the current form before
issuing another mutation.

### Canvas direct path and performance

For exact known edits the main agent calls ApplyCanvasEdits with the immutable
revision from ReadCanvas, code using CanvasEditor and optional plain-text snippets.
No editor model is invoked. The direct and design paths share actual browser text
measurement, validated operation dependencies, transient lane presentation, fresh
server revalidation and one atomic acknowledged commit. See
`docs/architecture/canvas.md` for the SDK, review-evidence and bounded cache/page
lease contracts. Never retain Puppeteer objects or sockets across Worker requests.

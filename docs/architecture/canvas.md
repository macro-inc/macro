# Canvas architecture

## AI editing

Ask Macro in the Drive header and standalone title menu attaches the canvas to the agent composer.
Documents owns `ReadCanvas` and `EditCanvas`, checked view/edit receipts, native
file-type validation, scoped actor-bearing document tokens, AI admission and
usage metering. Its existing tool context registers them for chat, agent
sessions and MCP; the toolset framework is unchanged.

`POST /canvas` on the AI editing worker joins the initialized shared scene using
the collaboration manager, sync engine and WAL. The model reads stable IDs,
containment/order, local/world transforms and bounds, then generates JavaScript
for `CanvasEditor` in bounded QuickJS. The host parses and validates operations,
executes a complete snippet on a disposable graphics editor, and commits its
delta once through the externally owned live Loro backend. It reads current
merged state immediately before that commit. Each snippet waits for a server
acknowledgement; an uncertain write stops the model and requires rereading
before another request. Earlier acknowledged snippets survive cancellation;
there is no transactional rollback of a whole model run.

The SDK supports boxes, text, bound connectors, world-space movement, box
resizing, styles, plain-text labels, grouping, reparenting and sibling ordering.
Existing embedded assets can move/resize/style, but new assets and reference
deletion stay in Canvas's authorized upload/mention lifecycle. Label content
remains one LWW string encoded by the shared Lexical codec, independent of pose
and appearance. Headless labels and text use the actual browser TextMeasurer with persistent
grow/contain/error fitting; no guessed line count determines committed height. Fresh canvases are initialized
in SyncService before creation returns. Legacy JSON canvases still use the
server-selected migration seed; tools report legacy migration requirements
separately from transport and authorization failures. The scene overview is bounded to 300 items, with stable-ID filters
for inspecting items beyond that overview.

Canvas Next is the Macro host for a reusable graphics engine. The host owns
product UI and services; `@macro-inc/graphics` owns the portable scene and editing
model.

## Layers

| Layer | Responsibility |
| --- | --- |
| Canvas Next | Toolbars, inspectors, Lexical, assets, permissions, persistence, migration, and Macro embeds |
| Graphics core | Immutable document tree, affine geometry, queries, commands, selection, and local history |
| Browser adapter | Pointer, keyboard, clipboard, drag/drop, and capture behavior |
| Solid adapter | Read-only rendering and editor overlays with stable component identity |
| Loro adapter | Typed Mirror tree projection, coordinate conflict policy, collaborative undo, and ephemeral presence |

## State boundaries

- The document stores stable IDs, ordered containment, local transforms, typed
  shape data, appearance, and durable references.
- The editor session stores selection, active tool, gesture previews, and history.
- The view stores camera, hover, focus, and other local-only state.
- Gestures preview transient state and commit one validated command when complete.

Graphics treats rich text as opaque content and assets as stable references. It
must not depend on Macro services, Lexical, the DOM, Solid, object URLs, or theme
variables. Canvas adapters resolve those concerns at the edge.

JSON is the import/export boundary and original migration seed. Once initialized,
the authoritative scene is a Loro document in SyncService. The Canvas host uses
the shared collaboration engine, local snapshot/WAL and permission-token transport;
the graphics adapter binds to that host-owned document and owns only scene history.
Only editors initialize rooms; viewers and nested canvases receive live changes
without editing. The server's serialized initializer chooses a single seed.
Copying preserves both the live room and original JSON, and downloads serialize
the current shared scene. Whole-file saves no longer run for canvas edits.

Shared presence carries cursors, selections and pending gestures on the runtime's
awareness channel, independently of document history. Geometry conflicts choose
one coherent pose; text/labels choose one complete content string. Remote commits
cancel local scene previews. Character-level text collaboration and gesture-intent
rebasing are separate work. No production participant limit has been measured.

## Principles

- Keep one authoritative representation for structure and transforms.
- Preserve world pose when moving items through the scene tree.
- Validate commands atomically and keep derived indexes out of saved data.
- Add capabilities through typed definitions and explicit adapters.
- Keep application migration and compatibility logic outside graphics core.

See the [graphics package README](../../packages/graphics/README.md),
[scene foundation](graphics-scene-foundation.md),
[Canvas Next README](../../apps/web/src/features/block-canvas/README.md),
and [collaboration notes](../../packages/graphics/src/loro/README.md).


### AI vision, fitting and parallel presentation

The Documents domain authorizes ReadCanvas/RenderCanvas/EditCanvas; the editing
worker joins the winning room seed. RenderCanvas freezes the canonical scene and
clock, sends it to an isolated real Canvas/StaticLexical render surface, and returns
native PNG content with revision/crop/object mapping. The browser loads only the
configured app bundle and fonts; embedded references are explicitly unavailable.
No render connects to sync or edits the scene. The agent adapter promotes only an
explicit bounded modelMedia envelope into native image content and rehydrates it
on history replay. Telemetry redacts image pixels.

An editing supervisor can delegate to two concurrent named writers. Actual command
reads/writes, hierarchy, connector dependencies, order and occupied regions govern
scheduling. Each batch validates, asynchronously measures text with the browser's
real TextMeasurer, presents transient awareness frames, pulls a server update barrier, then revalidates and commits
once through the canonical session's ACK queue. Human interference rejects stale
work. This coordination is session-local, not a distributed lock across independent
AI requests. Native CRDT merging and fresh dependency validation still apply there.
Requested fonts remain readable by default: persistent grow fitting increases box
height at the wrapping width; deliberate fixed sizes opt into contain or error.
Visual work receives an image before planning and a bounded final visual review.

Native creation follows the markdown lifecycle: create metadata, initialize the
canonical browser-generated `static_assets/canvas-golden.1.bin` snapshot, then mark
content ready in SyncService before returning. Manual creation and the empty
Canvas CreateDocument tool use this path; the tool rejects nonempty content before
creation and directs population through EditCanvas. Failed initialization or ready-state
updates compensate the possibly created room and metadata. The block selects
content location before requesting a blob through one Canvas query shared by the
Drive detail and block hosts, preserving legacy S3 migration.
Room existence requires an actual snapshot: a WebSocket connection alone never
marks an empty room initialized. Worker readiness errors distinguish a missing
snapshot from an initial-sync connection failure.

## Direct AI batches and bounded renderer reuse

ReadCanvas includes an immutable SHA-256 revision, canonicalized across replica
map insertion order. ApplyCanvasEdits takes that revision, bounded JavaScript and
optional plain-text snippets. The main agent uses the CanvasEditor SDK directly
for known edits instead of asking a nested model to translate them. EditCanvas
remains the natural-language design path. Both use the same edit receipt, scoped
sync token, QuickJS schema validation, real text measurement, target/region
revalidation, one Loro commit and WAL acknowledgement. An uncertain write must
never be blindly replayed. Direct batches invoke no provider and incur no nested
model token charge. No public REST or document-content replacement path is added.

```js
// expected_revision comes from JSON.parse(ReadCanvas.canvas).revision.
// Text is data; snippets are available inside the bounded interpreter.
editor.move(['existing-left', 'existing-right'], 0, 20);
editor.text('existing-title', snippets.title); // grow fitting by default
editor.textStyle('existing-title', {fontSize: 22});
```

Person mentions use `editor.mentionUser(itemId, at, {userId, email, displayName?})`,
following the document editing SDK. The host inserts the shared UserMentionNode
wire shape into the existing Lexical tree, retaining unrelated formatting and
chips. ReadCanvas exposes bounded `userMentions` with identity and UTF-16 offsets;
newlines and each U+FFFC decorator placeholder count as one character. Invalid
offsets or identities reject the proposal before any write. Mention edits go
through the same DOM measurement, target revalidation, and single commit as
other text edits; a human edit during async measurement invalidates the batch.
The main agent can resolve contacts with `macro.users.search(nameOrEmail)`,
which batches names from the existing contacts/auth APIs and returns seeded User
handles. It must disambiguate matches and never infer an identity from a name.
This adds no notifications or access grants.

Each ordinary batch can present up to three spatially ordered groups of actual
changed shapes. Descendants stay with their containing group. Bound arrows
whose resolved geometry changes stay with an affected node; cursors anchor at
those real nodes, not a connector's identity transform at the scene origin. Lanes carry only
bounded IDs/cursors/names; their shapes inherit the whole batch's dependency
guard. The receiver expands them into existing smoothed presence peers. Lanes
never create new sync writers or partial durable commits. Cancellation or a
changed target clears every lane. Reduced-motion viewers receive no ghosts.

EditCanvas supplies one initial image. Final review evidence must have been
consumed in a subsequent provider request, match the current immutable revision,
and cover every affected target and bound connector. Producing an image on the
last tool step does not count as reviewing it. If evidence is missing, a bounded
correction pass receives the current whole-scene image, the starting scene and
acknowledged tool history. It continues the existing edit instead of interpreting
a relative move as a new request. Main-agent instructions
avoid duplicating that internal image loop; direct deterministic edits use their
acknowledged geometry/text effects instead.

The browser pool retains only remote context/session IDs and counters across
Worker requests. Every lease opens its own CDP connection, preserving Worker I/O
ownership. Up to two leases per trusted render configuration (at most four local
configurations) reuse anonymous pages after disposing Solid roots, editors, DOM
and scene closures. No user cookies or referenced asset URLs are loaded. Reset,
startup/cancellation or render failures discard the context. Contexts retire on
60s idle, 5min age, 40 uses or 256MB JS heap; Cloudflare sessions keep alive 60s and
are checked before reconnecting. Metadata and caches are per-isolate best effort;
Cloudflare browser lifetime bounds recovery after isolate termination. Browser-owned
page deadlines also clear local scenes after 150s in flight or close idle pages
after 60s. Anonymous marker pages carry only an expiry; subsequent leases reap
expired contexts after an isolate crash without touching unrelated browser tabs.
A completely idle local browser may retain an expired tiny marker until its next
lease or process exit. Local development browsers are never globally killed.

Exact caches store cloned pure values after authorization and fresh sync: up to
8 renders/16MB/30s keyed by document ID, immutable revision, crop/options, trusted
render URL and renderer version; up to 32 measurements/8MB/60s keyed by document
ID, complete candidate scene, requested policies, render URL and version. Complete
candidate keys include content/font/wrapping/geometry and dependent connectors;
no approximate font or height cache can bypass actual DOM measurement. A cache
hit never returns mutable shared state. Oversized entries are not retained.

Canvas traces separate sync, sandbox, validation, scheduling wait, measurement,
cache hit, browser lease/page load/reset/heap, animation, revalidation, commit ACK
and correction. Only opaque IDs, timings, counts and image hashes are recorded.
The normal agent-session GenAI spans provide outer model/tool timings and usage.
Benchmark disposable copies; never run mutation benchmarks on a user's source.

### Reproduce local Canvas timing

Run `services/ai-editing-worker/scripts/benchmark-canvas.mjs` against a named
local stack and dedicated app/CDP renderer browsers. It copies its source before
**every** case and edits only those copies. The four prompts expect the Quicksort
fixture: a `QUICKSORT` title, three `FIXED PIVOT…` labels and unused space at
x2600–3100. Keep a private, mode-600 Playwright storage-state file for a local user
with copy/edit permission. Never commit that file, permission tokens, raw agent
session logs or provider trace payloads.

```sh
export CANVAS_BENCH_APP_URL=https://<hostname>:<preview-port>
export CANVAS_BENCH_SOURCE_ID=<quicksort-source-id>
export CANVAS_BENCH_WORKER_URL=http://<own-worker>:8933
export CANVAS_BENCH_CDP_URL=http://<own-app-cdp>
export CANVAS_BENCH_RENDER_CDP_URL=http://<own-renderer-cdp>
export CANVAS_BENCH_STORAGE_STATE=/tmp/private-local-storage.json
export CANVAS_BENCH_MODE=execution # repeat with main
export CANVAS_BENCH_OUTPUT=/tmp/canvas-execution.json
node services/ai-editing-worker/scripts/benchmark-canvas.mjs
CANVAS_BENCH_TEMPO_URL=http://<own-tempo> \
  node services/ai-editing-worker/scripts/collect-canvas-benchmark-traces.mjs \
  /tmp/canvas-execution.json /tmp/canvas-execution-traces.json
```

`main` creates real native-agent sessions with Sonnet 5.5; tool choice is not
forced. `execution` sends planned SDK batches without any model. Cold cases close
only explicitly idle anonymous renderer contexts before running; warm cases
reuse the page when it survives the configured bounds. Exact caches still require
matching document/revision/options; copied documents intentionally cannot hit
another document's cache. Inspect the exported `canvas.browser.warm` attribute,
not just the case label. An exact-hit experiment must repeat an unchanged read or
candidate in the same document. `CANVAS_BENCH_RESUME=1` skips recorded successful
cases; never replay an uncertain write automatically.

Output records first on-screen canonical DOM change, cursor observations, total
time, source preservation, rendered overflow and render/read revision agreement.
DOM change is measured within the Canvas viewport and excludes ephemeral ghosts;
it is not a compositor paint timestamp. Cursor wrappers have zero-size bounds, so
visibility uses their SVG/label children. Hidden browser tabs cannot reliably
measure paint with animation frames. Durable session-log timestamps can be
batched: use connected Tempo spans for tool/model timing instead. The collector
exports only whitelisted model/token/count/timing fields, never prompts or media.
Model inference, tool time and remaining uninstrumented gaps are reported
separately; cached provider input counts remain distinct from uncached input.

For a containerized local renderer, prefer a browser inside the named stack's
network when host Docker network changes cause Chromium `ERR_NETWORK_CHANGED`.
Keep CDP private to the stack and forward it only as needed. If another workspace
recreates the shared collector, attach a separate local OTLP collector to this
stack and override only this instance's endpoints. Preserve Compose YAML tags,
escape shell variables as `$$` in Compose commands, and preserve any explicitly
installed sync worker build when recreating that container. None of this requires
resetting volumes, application data, user roles or direct grants.

### Local measurements, 2026-10-23

Eight execution and eight real main-agent cases used disposable copies of the
same 60-item scene. Every case passed requested-outcome checks, preserved
unrelated items, had zero rendered text overflow and matched the final read/render
revision. Moves check all three exact world deltas and retained geometry/style;
relabels check text/font/color; callouts check count/position/width/font; diagrams
check the three readable nodes, spacing and two bound directed arrows. Read-only
verification can recheck existing results with `CANVAS_BENCH_VERIFY=1`, without
replaying any edit. The source's immutable revision remained unchanged.

| Case | Execution cold / warm | Main-agent cold / warm | First visible canonical change, main cold / warm |
| --- | --- | --- | --- |
| move | 0.96s / 0.90s | 39.72s / 10.55s | 30.12s / 8.28s |
| relabel-style | 5.01s / 1.15s | 18.89s / 15.85s | 14.85s / 12.02s |
| callouts | 4.87s / 1.17s | 16.39s / 11.65s | 13.07s / 8.72s |
| diagram | 4.85s / 1.10s | 28.39s / 18.88s | 19.79s / 11.58s |

All main-agent cases selected ApplyCanvasEdits. Only the diagram cases requested
RenderCanvas for final visual review; none delegated to EditCanvas. The direct
path invoked zero models. Main cases used four Sonnet 5.5 steps (five for diagram)
plus one opener-model and one classifier call. Connected traces measured actual
model wall time separately from tool execution; the 39.72s cold move included
38.34s of model calls and 1.25s of tools. This is provider variation, not a 39s
Canvas animation. There is no controlled before/after speedup claim against a
different original user prompt.

Actual Sonnet usage summed over those steps follows. Input categories are
separate provider counters, not inferred from prompt length. Auxiliary opener
and classifier counts/tokens are retained separately in the safe trace projection.

| Case | Cold/warm | Steps | Uncached input | Cache read | Cache creation | Output |
| --- | --- | --- | --- | --- | --- | --- |
| move | cold | 4 | 12 | 167797 | 98859 | 655 |
| move | warm | 4 | 14 | 211128 | 53728 | 655 |
| relabel-style | cold | 4 | 12 | 213002 | 53896 | 666 |
| relabel-style | warm | 4 | 14 | 211153 | 53918 | 738 |
| callouts | cold | 4 | 14 | 211237 | 54929 | 1001 |
| callouts | warm | 4 | 12 | 213106 | 54990 | 902 |
| diagram | cold | 5 | 16 | 315388 | 61659 | 1751 |
| diagram | warm | 5 | 16 | 314729 | 60822 | 1552 |

The execution trace confirmed cold browser leases around 4.0s versus 0.24–0.29s
for warm leases. These are warm-page results across distinct documents, not exact
cache hits. A separate unchanged-candidate measurement experiment took 4.01s
initially and 2.4ms on the exact hit; mutating the returned value did not change a
later cached result. A repeated immutable render previously measured a 26ms exact
hit. Authorization and fresh sync remain outside those cache shortcuts.

A separate real EditCanvas design call created three readable boxes in 8.21s,
using three model steps with native image counts 1, 1, 2 and no redundant final
correction pass. Regression cases still require correction for an unconsumed
last-step render, a crop that misses targets, or a later full render sharing an
older partial render's revision. Matching requires both the per-render nonce and
actual normalized image hash in the provider request.

Live multiplayer checks showed three named operation lanes from one batch. A
browser human nudge rejected the entire stale batch and retained that nudge;
cancellation left the AI move unapplied and cleared presence. A reduced-motion
desktop client showed zero ghosts while a phone client showed all three lanes.
Both clients converged after reload. Cursor visibility counters in the timed
matrix predated the SVG-child bounds correction; those zero counts are not used
as lane evidence. The separate live lane observations are authoritative.

These measurements use the local CDP adapter, development frontend and actual
providers. Cloudflare's deployed Browser binding was not deployed or benchmarked.
Warm state is best effort and bounded; the first request after expiry or failure
still pays a cold load. Caller-disconnect usage reporting retains the documented
document-editing limitation.

A further real-model relative-move test forced the fallback correction path.
Without the acknowledged tool history it moved the same boxes twice. With the
continuation context, the same test applied one move batch, retained the requested
20-unit deltas and performed its correction review without repeating them.


## Mirror tree integration

The graphics Loro backend owns a `@loro-mirror/core` Mirror with a typed
`schema.LoroTree` under the existing `scene` root. JavaScript nodes are
`{ data, children }`; an ID selector maps stable graphics IDs to native Loro tree
nodes. Mirror handles generic create, move, reorder, delete and map-field diffing.
The graphics adapter retains scene validation, coherent pose capture and
world-coordinate interpretation when concurrent parent and pose winners differ.
Atomic pose and label-style values use `schema.Value`; text stays a separate LWW
string. No persisted tree conversion is needed, and opening a scene emits no
operations. Host metadata roots coexist with the scene schema and remain outside
scene undo and notifications. The host's sync manager disables its generic Mirror
because the graphics backend owns this typed Mirror on the same durable LoroDoc.

# Graphics editor architecture — original design and current decisions

Status updated 2026-09-28. The primary progress index and proposed next checkpoints
are in [Graphics and Canvas parity](GRAPHICS_PARITY.md). This document retains the
2026-09-23 design/research rationale; its initial phases and rectangle-only scope
are historical, not the current backlog. Current contracts live in the
[graphics README](../packages/graphics/README.md), [scene foundation](GRAPHICS_SCENE_FOUNDATION.md)
and [Loro adapter notes](../packages/graphics/src/loro/README.md).

Implemented: `@macro-inc/graphics` pure TS tree/affine/command/selection/history
core; browser and keyed Solid adapters; stable sibling ordering; local Canvas Next
with pencil, rich text/shape labels/mentions, bound connectors, media, interactive
document cards and full document/legacy-canvas embeds. Shared controls, transform
interactions, pencil cache reuse and viewport-based Fit Scene are in place.

Decisions now made: TS is the type source; feature registration is explicit and
centrally compiled; Canvas Next owns Lexical and stores its serialized tree as one
whole-string LWW value. Graphics treats that content as opaque; Canvas Next
owns the Lexical codec, validation and empty-content decisions. There is no
character-level collaboration. The optional LoroTree backend has native local
undo and isolated ephemeral awareness. Its visual peer demo is still smaller than
Canvas Next and does not yet validate the full mixed-content editor.

Canvas Next now has gated version 2 JSON persistence, frontend legacy migration
and document-level read-only enforcement. SyncService wiring and collaboration
remain follow-up work. The standalone playgrounds use an unversioned model and disposable
seed scripts. The Canvas Next demo has local debug storage; real Canvas Next
documents have versioned JSON at the durable boundary. Embedded documents keep
their existing sync independently of the outer canvas.

## Goals

Move document semantics, operations, history, and persistence coordination into a
framework-independent TypeScript library. Keep Solid components and fine-grained
reactivity for rendering. Support whiteboarding and image annotation first, with
room for slides and DOM-oriented design tools. Make features documented, typed
plugins. TypeScript declarations own public types; runtime codecs validate external
data. Design collaboration semantics now, with an explicit Loro/SyncService path.

## Legacy source audit (2026-09-23)

| Area | Current implementation | Implication |
| --- | --- | --- |
| Model | `apps/web/src/features/block-canvas/model/CanvasModel.ts` | Zod defines types, defaults, coercions and legacy migrations together. A video type guard depends on a feature flag. |
| State | `context/canvas-document-state.ts` | Document records, selection, gestures, history, camera, DOM references, Lexical editors and saving flags share a Solid state factory. |
| Mutations and saving | `store/canvasData.ts` | CRUD depends on context, Solid setters, selection, render queues, mention tracking and DSS saves. Export enumerates the render queue. |
| Interaction | `operation/*.ts`, `signal/toolManager.ts`, `component/CanvasController.tsx` | Operators consume browser events and modify Solid state. Move previews write document positions before commit. |
| History | `signal/canvasHistory.ts` | JSON snapshots include nodes, edges, render queue and selection, but omit the group record store. |
| Rendering | `component/CanvasRenderer.tsx`, `component/BaseRenderer.tsx` | Existing DOM/SVG Solid components are reusable assets; type dispatch is hardcoded. |
| Host boundary | `component/CanvasDocument.tsx`, `context/canvas-document-context.tsx` | A useful document-scoped provider already exists. Preserve both block and drive-view hosts. |
| Persistence | `queries/canvas-document.ts` | Whole JSON files go through `simpleSave`; camera location is saved separately. |
| Collaboration | `packages/collaboration/src/collab/{manager,engine,wal,snapshot-store}.ts` | Existing manager, engine, recovery, transport and storage should be reused. Imperative classes and Solid wrappers still share modules/contracts. |
| Server | `services/sync-service/src/domain/document.rs` | Content-agnostic Loro snapshot/update APIs already exist. This does not establish canvas initialization, routing or migration support. |

Specific behaviors to characterize before migration: failed saves currently still
clear `pendingUpdates`; an older save completing can clear a newer edit's dirty
flag; loading validates records but retains the original rather than the parsed
output; removing an item from the render queue affects exported membership.
These are source-level observations, not reproduced bug reports.

## Proposed boundaries

```text
Macro host: identity, permissions, assets, comments, navigation, service adapters
                         |
Product composition: whiteboard / image markup / later slides and design
             |                              |
graphics-solid                       graphics-core
components, keyed projection         document + editing session
             |                       commands + tools + geometry
graphics-browser                     plugin registry + codecs
input, measurement, clipboard        persistence contracts/coordinator
                                            |
                                  injected document backend
                                  memory or graphics-loro
                                            |
                                  shared collaboration runtime
                                  local storage + SyncService
```

These are import boundaries: core never imports the app, Solid, browser globals,
Loro, or service clients. Adapters depend on core contracts. Start with a small
number of workspace packages and feature subpath exports; do not create a package
per tool. Keep product composition in the web feature architecture described in
`FRONTEND_FEATURE_ARCHITECTURE.md`.

### Document, session and view

**Document:** durable records, stable IDs, containment and sibling ordering,
geometry, styles, connector bindings, asset references and plugin-owned content.
Introduce format versions only at durable/exchange boundaries; current playground
documents remain unversioned. Export from document state,
never visibility, mounted components or selection.

**Editing session:** selection, camera, active tool, gesture state, snapping,
hover and transient previews. Plain TypeScript with explicit subscriptions and
disposal. Multiple views can share a document while retaining separate sessions.
Selection can accompany undo as local metadata; it is not shared document state.

**View:** Solid projections, DOM references, text editor instances, menus, focus,
measurement and resource lifetimes. Browser measurement is injected into algorithms
that need it. Derived bounds and spatial indexes are rebuildable caches.

Use one authoritative committed document backend per instance. A memory backend
supports extraction and tests; a Loro backend owns committed state when enabled.
Do not retain independent writable core, Solid and Loro documents and synchronize
them with effects. The Solid store is a read-only projection for consumers.

### Document vocabulary

Use a normalized record model with a typed registry of record kinds. Shared
structure should cover stable identity, kind/version, containment and order;
plugin properties are typed by kind. Do not force every record to carry a union
of every product's style and behavior.

- Pages/surfaces: infinite for whiteboards, image-sized for annotation, ordered
  fixed-size for slides. The legacy canvas migrates into one surface.
- Spatial items: local transforms, dimensions and plugin properties. Support
  nested coordinates and rotation at the contract level; do not build every UI now.
- Connectors: explicit endpoint references and fallback coordinates. Derive
  adjacency indexes instead of maintaining a second authoritative `node.edges` list.
- Containment: one authoritative relation. Child lists are derived; do not store
  unrelated `groupId` and child arrays as competing truths.
- Assets: durable IDs plus metadata; upload progress, object URLs and decoded
  resources live outside the shared document. Image bytes stay in asset storage.
- Comments: typed spatial/item anchors and external thread IDs. Comment bodies,
  permissions and notifications remain behind Macro's comment capability unless
  product requirements explicitly choose embedded discussions.

For future DOM layout, allow layout-driven items whose measured rectangles are
derived. Do not make persistent absolute x/y the only layout model. Slides and
design share selection, assets, transformations and extensibility, but should not
inherit whiteboard interaction policy by default.

### Commands and gestures

Commands express document intent: create, delete, translate, resize, group,
reparent, reorder, change style, attach a connector. They run inside synchronous,
atomic transactions with a stable origin and history grouping. Inject IDs and
other nondeterministic inputs. Failed validation produces no partial commit.

Tools are state machines consuming normalized pointer/key inputs, independent
of `PointerEvent`. Browser adapters own pointer capture, focus, IME, clipboard,
drag/drop and coordinate measurement. Tools create commands and preview overlays.

Current gesture policy: pointer movement updates a session overlay; pointer-up
commits one semantic transaction; Escape drops the overlay. The experimental Loro
adapter cancels active drawing/transforms on incoming commits. Rebasing translation
intent against the latest record is a possible future policy, not implemented.
Specify separate resize, reparent and text policies rather than applying
one generic rebase. Optional live drag previews travel through awareness. If
durable intermediate commits are required later, add explicit history grouping
and cancellation semantics instead of broadcasting inverse snapshots.

Async work such as uploads occurs outside a transaction. On completion, issue
a new command only if its target and session are still valid. Mention tracking
and other host effects consume committed changes through an adapter; they cannot
silently turn successful document edits into failed saves.

### Preserving Solid rendering

Subscribe to committed change batches and session changes, then update only the
affected paths in a Solid store inside `batch`. Render stable IDs through keyed
components; look up current records reactively. Unchanged entities must not remount
when another entity moves. A renderer registry maps kinds to Solid components.

Current adapter: document notifications still publish whole snapshots. A reconciled
store serves fine-grained UI reads, while an immutable snapshot signal serves
geometry queries/rendering so brush caches retain their identities. Move/rotation
previews retain unchanged geometry; per-item memos suppress unchanged render work.
Affected-ID commit batches and general incremental scene queries remain future work.

Keep semantic order independent of the renderer's visible-ID list. Spatial culling
must not remove records from persistence. Pin focused editors during culling and
test selection portals, rich text focus, nested canvases and image resource cleanup.
Solid setters are private to the adapter; component edits call commands.

### Plugin contract

Initial assumption: internal, statically bundled modules registered when creating
an editor. A runtime third-party marketplace would require a separate isolation,
permissions and compatibility design.

Each plugin declares an ID, version, dependencies and contributions:

This is the fuller proposed contract. The implemented extension API is narrower:
typed `ShapeDefinition`, a separate mapped Solid renderer registry, typed commands
and explicit gesture modules. Per-editor core registry composition, dependency
resolution, unknown-kind preservation and migrations are not implemented yet.

| Pure core contribution | Separate browser/Solid contribution |
| --- | --- |
| Typed record definitions, defaults, codecs and migrations | Renderer and inspector components |
| Geometry, bounds, hit testing and transform behavior | Text/image measurement and resource loading |
| Commands, tools and capabilities | Toolbar entries, shortcuts and overlays |
| Import/export behavior | Clipboard and downloadable export integration |

Register deterministically, reject duplicate IDs/missing dependencies, and return
explicit disposers for runtime subscriptions. Plugins write through transactions;
no arbitrary mutation hooks after commit. Unknown optional record kinds must
round-trip intact and render placeholders. Unknown required semantics should
force a clear read-only/unsupported state, not silently discard content.

Document one complete extension example: add a numbered annotation item with
typed properties, validation, migration, geometry, tool, renderer, history behavior,
serialization and collaboration tests. Product presets select plugins and policy;
avoid hundreds of booleans in a universal editor component.

### TypeScript as the source of truth

Declare interfaces and discriminated unions directly. Codecs accept `unknown`
and return typed values or structured errors; do not use `z.infer` for core types.
Retain the old Zod decoder only at the legacy import boundary during migration.

Separate decoding, version migration, validation and normalization. Never silently
drop invalid records on load. Preserve recoverable unknown content and report
diagnostics. TypeScript alone is not runtime validation: use typed codec contracts,
compile-time compatibility checks and golden round-trip fixtures. Choose generated
validators versus maintained codecs in a small spike, not by substituting another
schema-first library. Loro container mappings also implement the TS contract rather
than becoming a new source of truth.

## Loro and SyncService

Prove the CRDT representation early, even if live collaboration ships later.
Keep the abstract backend contract small: read, transact, subscribe, history and
snapshot lifecycle. It need not expose Loro containers or promise interchangeable
semantics for arbitrary future storage engines.

Candidate mapping to validate:

- Keyed records and independently editable properties use maps; avoid replacing
  an entire document or item as one JSON value.
- Geometric values that must stay coherent, such as a transform, can be atomic
  values. Choose and document same-item move/resize conflict behavior explicitly.
- Containment and sibling order: spike LoroTree against the required grouping,
  ordering and reparenting operations. The local Loro Mirror schema currently has
  maps/lists/movable lists/text, but no tree schema; direct bindings or a focused
  Mirror extension may be required. Avoid inventing a parent-map scheme that can
  create cycles under concurrent reparenting.
- Text decision (supersedes the original character-collaboration proposal): keep
  the exact stringified Lexical tree in one LWW content register, separate from
  pose. Canvas Next uses the shared Markdown builder without a Markdown round trip.
  Concurrent completed edits choose one whole tree; local drafts and typing undo
  belong to Lexical. No character CRDT or remote text carets are planned now.
  Lexical is application-owned: serialization, format validation, content/empty
  detection, editing, rendering and DOM measurement stay there. Graphics owns
  opaque string content, text/label geometry and layout through an injected
  measurer. The collaboration adapter stores the string without interpreting it.
  Canvas Next owns this codec in `core/text-codec.ts`; graphics fallbacks display
  literal strings and hosts with encoded content supply rendering and measurement.
- History in collaboration uses local-operation undo with explicit gesture and
  text-edit boundaries. Remote changes never enter local undo as snapshots.
- Presence, selections, cursors and live previews are ephemeral awareness.

Loro's documented [local undo](https://www.loro.dev/docs/advanced/undo),
[tree](https://www.loro.dev/docs/tutorial/tree) and
[text semantics](https://www.loro.dev/docs/tutorial/text) support exploring these
choices. Validate against the repository's pinned version and actual bindings.

Extract framework-free entry points for the existing collaboration manager/engine
and their necessary contracts. Leave Solid ownership wrappers in a separate export.
Reuse WAL, snapshots, acknowledgements, reconnect and multi-tab behavior; do not
write a second sync engine. Scope extraction by dependency inspection and preserve
existing Markdown/spreadsheet behavior with their integration tests.

Persistence status distinguishes applied in memory, durably saved locally, and
acknowledged remotely. Track revisions instead of a boolean dirty flag; only an
acknowledged revision becomes saved. Serialize legacy full-file saves and retry
failures. Persist during editing; unload is a best-effort flush, not durability.

Server work includes canvas snapshot initialization, content-location metadata,
authorization/token wiring, copy/export/history consumers, and legacy readers.
The existing documents fallback classifies canvas as object storage, so enabling
a socket alone cannot complete this migration. Audit AI/import/export consumers
before changing the file format. Assess snapshot/update limits with large drawings.

Use an idempotent migration keyed to the legacy document revision. Preserve IDs
and source JSON, create one canonical Loro seed under a server-controlled migration
gate, and atomically select the new content location. Do not let two clients seed
the same legacy content independently. Prevent old clients from overwriting a
migrated document. Avoid dual authoritative writers. Before cutover, rollback uses
legacy storage; after new edits, rollback requires an explicit current-state export
or compatible reader, not reopening a stale backup. Incompatible CRDT schema
migrations need version-gated coordination, not per-client load-time rewrites.

## Original implementation sequence and exit criteria

Current phase assessment: pure model/commands and the Solid slice are built, but
the persistence portions of phases 1–3 are not. Phase 4 has the main local content
and editing flows, with imports/exports and document-host integration outstanding.
Phase 5 has the centered-image rectangle prototype only. Phase 6 has the optional
Loro backend and local peer harness, not production rollout. Phase 7 is unstarted.
Use the [current checkpoint table](GRAPHICS_PARITY.md#5-recommended-checkpoint-sequence)
and [next-step choices](GRAPHICS_PARITY.md#6-next-checkpoints-to-choose-from) for planning.

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 0. Characterize and spike | Legacy fixtures, behavior inventory, render/performance baseline; small Loro containment/text/undo experiment | Chosen state ownership and CRDT semantics survive concurrent edits, deletion, reorder and cancellation. |
| 1. Types and model | Pure TS model, geometry, versioned codecs and legacy migration | Core imports without Solid/DOM/app setup; representative documents round-trip without silent loss. |
| 2. Transaction kernel | Memory backend, commands, session/preview state, history and revision-aware persistence coordinator | Create/move/resize/delete/group/undo/save work in headless tests; preview cannot leak into saved state. |
| 3. Solid vertical slice | Existing shape and connector renderers wired through keyed adapter; browser input normalization | Create, drag, resize, connect, cancel, undo, save and reload work; unrelated components retain identity. |
| 4. Canvas parity | Remaining text, media, clipboard, selection, alignment, ordering, imports/exports and host integrations | Existing canvas workflows pass in both hosts; old mutation paths removed; rich text/IME and uploads verified. |
| 5. Second product | Image markup preset: bounded image, annotations and comment anchors | Product uses shared APIs without importing whiteboard internals; extension cookbook works end to end. |
| 6. Collaboration rollout | Loro backend, framework-free collaboration exports, server initialization/migration and gated rollout | Multi-client/offline/reload/reconnect, local undo, permissions, mixed-version and migration-race tests pass. |
| 7. Expansion | Whiteboard feature backlog, then slide/design proof-of-concepts | Future apps demonstrate composition without expanding the kernel into product-specific policy. |

Phase 0 includes the Loro proof; phase 6 is production integration, not the first
time collaboration is considered. If collaboration must ship in the first release,
move the Loro backend and history implementation into phases 2–3 and treat memory
storage primarily as a test adapter. Avoid a throwaway second production history.

Run affected package tests and `just check` for implementation changes; browser
verification covers user-visible behavior. Add import-boundary tests, command and
migration fixtures, save-race tests, adapter identity tests, and multi-replica CRDT
tests. Measure drag latency, change-batch size, mounted component counts and
document load/save on agreed small/large fixtures before setting numeric budgets.
Update the app agent guide when user workflows change.

Whiteboard parity and a fully featured Excalidraw-like experience are different
milestones. Track gaps explicitly: rotation, nested groups/frames, snapping and
guides, connectors/bindings, rich text, drawing tools, export fidelity, touch,
keyboard accessibility and performance. Agree the release feature set before
estimating a schedule; this draft supplies sequencing rather than invented dates.

## Decisions to resolve together

1. Must live collaboration ship with the first replacement canvas, or follow parity?
2. Initial extension model is settled: internal compile-time modules. Per-product
   core registry composition can follow demonstrated needs; external loading is deferred.
3. Is image markup a standalone document, an attachment-associated surface, or both?
   Default proposal: reusable embedded surface with an optional standalone host.
4. Should comments reuse Macro threads? Default: yes, via anchored references.
5. Rich text/mentions and shape labels exist; whole-string LWW is settled. Which
   subset belongs in the annotation and future slides presets remains open.
6. Does the first whiteboard release target current parity or an agreed expanded
   feature set? Which large-document and touch workflows are release requirements?

The first implementation slice and Loro spike are complete. Current user priority:
[bidirectional legacy bridge and canvas colors](CANVAS_LEGACY_BRIDGE.md). Full peer
UI expansion is deferred. Existing JSON storage is a possible integration path;
production Loro migration is not a prerequisite for testing the new editor on old data.

## Follow-up: multiplayer, undo and schema research

Reviewed Excalidraw source at commit
`2b9da9610083254edaec68871d593fb6b08e9072`, Figma's published engineering accounts,
and ran three isolated map/undo probes against Loro 1.16.3 (the repository catalog
version). The installed root dependency was 1.13.7, so the probe used a separate
temporary copy of 1.16.3 without changing workspace dependencies.

### Findings

Excalidraw's [reconciliation](https://github.com/excalidraw/excalidraw/blob/2b9da9610083254edaec68871d593fb6b08e9072/packages/excalidraw/data/reconcile.ts)
chooses whole elements by version, breaking ties with versionNonce; some active
local edits are protected. Its [history](https://github.com/excalidraw/excalidraw/blob/2b9da9610083254edaec68871d593fb6b08e9072/packages/excalidraw/history.ts)
instead uses property deltas. Remote updates bypass history capture, and undo/redo
creates fresh versions. Its [multiplayer tests](https://github.com/excalidraw/excalidraw/blob/2b9da9610083254edaec68871d593fb6b08e9072/packages/excalidraw/tests/history.test.tsx#L2170)
explicitly cover preserving unrelated properties and updating redo values after
remote edits to the same property. Thus network merge granularity and undo
granularity need not be identical.

Figma's [2019 account](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
describes server-ordered property updates, stable object IDs, atomic parent/order
pairs and server rejection of containment cycles. Redo is updated during undo.
This is a historical published design, not access to today's private implementation.
Its [2025 code-layer account](https://www.figma.com/blog/building-figmas-code-layers/)
describes specialized Eg-walker text collaboration, reinforcing that text can need
different semantics from graphic properties.

### Observed Loro behavior

Each probe used two distinct peers seeded from the same snapshot, committed edits,
exchanged updates, and a local UndoManager with time-based merging disabled.

| Probe | Before local undo | After undo | After redo |
| --- | --- | --- | --- |
| A sets white→red, B sees it and sets blue | blue | white | blue |
| A sets red and B concurrently sets blue; merge selects blue | blue | white | blue |
| A moves x=0→10, B concurrently changes fill | x=10, blue fill | x=0, blue fill | Not exercised |

Assertions checked redo restoration in both color cases and convergence after
undo in the independent-property case. These are narrow runtime observations,
not proof of tree, rich-text, deletion or multi-step history behavior.

Local undo means the stack records local actions; it does not guarantee an undo
cannot overwrite a later remote value on the same property. The product must
choose this behavior knowingly. A policy that skips overwritten fields is a
different design and should not be presumed to match native Loro history.

### Refined schema recommendation

Start with a typed item map and explicit merge units, with hierarchy representation
still provisional. Avoid one JSON register per item and avoid automatically
turning every nested property into its own mergeable field.

| Value | Candidate merge boundary | Rationale / remaining question |
| --- | --- | --- |
| Identity and kind | Stable, normally immutable | Reparenting cannot replace identity. |
| Fill, stroke, opacity | Independent fields | Styling should compose with movement and with unrelated style edits. |
| Geometry | One coherent value initially: position, size, rotation | Concurrent resize/move selects coherent geometry; trades away merging independent geometric edits. Prototype before fixing this boundary. |
| Placement | Ordered tree operation, or atomic parent/order value | A plain parent/order map still needs cycle resolution. |
| Connector endpoint | One discriminated value per end | Target, anchor and fallback cannot merge into an invalid combination. |
| Text | One exact serialized Lexical string, separate from pose | Chosen whole-content LWW policy; local editor owns typing undo, backend owns completed-edit undo. |
| Freehand path | Atomic completed path initially | Collaborative point-level editing is unnecessary unless explicitly required. |
| Asset reference | Stable ID; shared metadata separately | Loading state and bytes do not belong in the editable item record. |
| Plugin properties | Declared merge units | Extensibility must include collaboration semantics, not only TS types and renderers. |

Transactions and merge boundaries are different: committing several fields together
does not guarantee their values win together when concurrent writes merge.
This particularly matters for reparenting: geometry in parent-local coordinates
depends on the selected parent. LoroTree can address hierarchy convergence but
does not automatically preserve world-space geometry across concurrent reparenting
and movement. Prototype this explicitly; options include coupling placement and
pose, or a documented rebase/repair policy. Repairs must converge and must not
generate endless corrective writes between clients.

Separate three concepts in the public model: structural containment (coordinate
space, layout, clipping), selection grouping, and connector relationships. A
whiteboard selection group need not become a DOM/layout parent. This reduces the
pressure to force every relation into the tree and leaves room for product-specific
group behavior.

### Prototype before freezing storage

Use a small deterministic multi-replica harness and compare two candidates:
LoroTree with attached item data, and keyed item data with explicit placement.
For the second, cycle handling is required work, not an assumed map property.
Preserve the chosen TypeScript domain API while testing both storage mappings.

Required behavioral cases:

1. Move versus restyle; independent style edits; same-property edits and undo/redo.
2. Resize from opposite corners; move versus resize; rotation versus resize.
3. Reparent versus move; concurrent opposite reparenting; reorder in different parents.
4. Delete versus edit; undo creation after another user edits the item; undo deletion.
5. Delete group versus reparent child; connector targets deleted or restored.
6. Remote updates during drag; cancel; history grouping with conflicting imports.
7. Concurrent text edits, text focus/cursor restoration, and document/text undo routing.
8. Offline reconnect, reordered/duplicate deliveries, and multiple local views/tabs.

Check both convergence and meaningful geometry/reference invariants. Specify the
expected visible outcome for every test first. Treat the CRDT mapping as a decision
produced by this experiment; the kernel and plugin API should not freeze it earlier.

## Historical first increment: rectangle playground (completed and superseded)

The following records the original deliberately small scope. It is not a list of
current limitations: hierarchy, transforms, content types and Loro have since landed.

Requested scope: a new workspace package, exercised inside the existing web app
through the split component registry. Infinite surface, selection and rectangle
tools. Iterate on interaction and the core/view boundary before migrating Canvas.

### Package and host

Use `packages/graphics` (`@macro-inc/graphics`) with three explicit entry points:

```text
packages/graphics/
  src/core/         # root export: model, geometry, editor/session, commands, tools
  src/browser/      # /browser: pointer, wheel, keyboard and viewport adapter
  src/solid/        # /solid: reactive projection, surface and rectangle renderer
  README.md
  tsconfig.core.json # ES libs only, no DOM or framework imports

apps/web/src/features/graphics-playground/
  graphics-playground.tsx # production mounting and split header
  views/                 # playground composition
```

Use subdirectories only as they gain responsibilities. The existing machine
package demonstrates a separate `/solid` export; email-renderer demonstrates a
separate `/browser` export and core type-check. Solid is an optional peer dependency.
The root barrel must never re-export the other entry points. Enforce the boundary
with import checks in addition to the no-DOM type-check.

Register `graphics-playground` lazily under `LOCAL_ONLY` in
`apps/web/src/components/app/split-layout/componentRegistry.tsx`, using the existing
debug-page pattern. Open through the split router's component route. Each mounted
playground owns an independent editor with explicit disposal. The page needs no
document ID, storage requests or legacy Block provider. Follow existing split
header conventions and semantic theme tokens at the host boundary.

### Minimal state

The initial document is a typed map of rectangles plus a flat ordered
ID sequence. Rectangle data has an immutable ID/type, a coherent axis-aligned
`{ x, y, width, height }` geometry value, and simple appearance. This is a local
prototype representation, not a committed CRDT schema or long-term file format.
This describes the initial prototype only and is superseded by the scene foundation
checkpoint; hierarchy and transform math are now required before further features.

Session state holds camera, selected IDs, active tool and a discriminated gesture
state: idle, panning, creating a rectangle, marquee selection, or moving selection.
Preview geometry lives here. Document changes go through a small command API;
commit emits one change batch containing affected IDs. Avoid a general middleware
pipeline or interchangeable storage-backend framework in this increment.

### Item definition versus renderer

Adopt the extensible-view idea of Lexical decorators, with explicit separation:

- A pure typed definition owns `type`, creation defaults, bounds and hit testing.
- Plain item data contains no methods, JSX, DOM nodes or component references.
- A separate Solid registry associates each kind with a component accepting that
  exact item type. Use a mapped type over the item union to enforce completeness
  and the kind/props relationship; avoid `Record<string, Component<any>>`.
- The surface owns positioning, selection outlines and gesture routing. The
  rectangle component paints its content. Core geometry, not DOM layout, determines
  selection and hit testing.
- Render by stable ID and read changing item data through reactive props/accessors.
  Updating one item must not recreate component functions or remount other items.

For now the registry contains only `rectangle`, and dispatch can be explicit.
Add a typed `defineItem` registration helper only if it improves the first extension;
no global registry, class hierarchy, declaration merging or runtime plugin loading.
Revisit interactive embedded content/focus delegation when adding a text or image
item that needs it. The current Lexical decorator bridge is an architectural
reference, not code to transplant: it solves DOM mounting inside Lexical's tree.

### Interaction contract

| Capability | First increment behavior |
| --- | --- |
| Infinite surface | Unbounded world coordinates, transformed DOM/SVG content and zoom-aware background grid; viewport remains clipped to the split. |
| Pan | Wheel/trackpad scroll, middle-button drag, Space + primary-button drag. |
| Zoom | Ctrl/Meta + wheel zooms about the pointer; toolbar provides reset/zoom controls. Normalize wheel units and clamp finite scale. |
| Rectangle tool (`R`) | Drag in any direction, normalize bounds, show preview, commit on release and select the new item; return to Select. Below-threshold drags create nothing. |
| Selection tool (`V`) | Click topmost hit, Shift-click toggles membership, empty click clears selection. |
| Marquee | Empty-space drag selects intersecting rectangles; Shift adds to the selection captured at gesture start. |
| Move | Drag selected items as one group; dragging an unselected item selects and moves it. Use a screen-space activation threshold. |
| Delete | Delete/Backspace removes selected items in one command. |
| Cancel | Escape/pointer cancellation drops preview; Escape while idle clears selection. Blur/lost capture cancels active gestures. |

Selection is evaluated in world space; activation thresholds stay in screen pixels.
Pointer-up outside the viewport completes through pointer capture. Prevent browser
defaults only for handled gestures. Shortcuts belong to the focused surface and
must ignore text inputs; opening two splits must not make one edit both. Toolbar
buttons remain keyboard accessible. Pointer events cover mouse/pen and basic
single-pointer use; multi-touch navigation is a later increment.

Use linear bounds queries initially. A spatial index, viewport virtualization and
performance tuning beyond stable reactive identity need measured justification.

### Small implementation checkpoints

1. **Surface:** scaffold package/exports, typed rectangle data, camera math, Solid
   projection, renderer and registry-mounted playground. Render seeded rectangles;
   pan and pointer-anchored zoom work.
2. **Create:** normalized input and rectangle state machine; preview, commit and
   cancellation work in all drag directions.
3. **Select and move:** hit testing, marquee, multiple selection, movement and
   deletion; complete the focus and lifecycle behavior.

Each checkpoint should be reviewable independently. Stop this increment after
checkpoint 3 for hands-on iteration. Undo/redo can be the next small increment;
the commit boundaries make that possible without committing to a storage schema.
Persistence, Loro, hierarchy, connectors, resize/rotation handles, rich text and
legacy Canvas migration remain later milestones.

### Acceptance and verification

- Core unit tests cover coordinate conversion, zoom anchoring, rectangle
  normalization, topmost hit testing, marquee and gesture commit/cancel behavior.
- Import tests enforce no Solid/DOM/app dependencies from the core export.
- Solid adapter tests check reactive geometry and stable mounts across unrelated
  edits; disposal removes subscriptions and event listeners.
- In the actual registry-mounted browser page, exercise creation at non-default
  zoom, pan/zoom, selection, drag outside bounds, cancel, deletion and two splits.
- Run package tests/type-check, affected web tests/type-check and `just check`.
  Add the playground route and tool behavior to the app agent guide.
- README documents the three imports, state ownership, initial rectangle contract
  and how to add another item definition plus renderer.

# Graphics and Canvas parity plan

Canvas Next now opens saved documents behind `enable-canvas-next`, migrates
supported unversioned/version 1 JSON on load, and saves version 2 after edits.
The original legacy payload is retained; unsupported records offer the legacy
editor. Read-only access and serialized JSON saves are wired at the host boundary.
SyncService and collaborative rollout remain a follow-up. See the
[Canvas Next format and rollout notes](../apps/web/src/features/block-canvas/canvas-next/README.md).


Rewrite status reviewed 2026-09-28. This is the primary progress and next-checkpoint
index; package READMEs describe the implemented contracts. The legacy/Excalidraw
comparison is the source audit from 2026-09-24, not a new upstream audit. It is a
planning inventory, not a fresh runtime certification of every
legacy feature. Excalidraw master may lead the deployed app; Plus-only product
features are outside the baseline. Priorities below are recommendations.

A1 and A2 are implemented in [Canvas Next](../apps/web/src/features/block-canvas/canvas-next/README.md).
Saved documents use an opt-in rollout and versioned JSON load/save path;
production sync remains deferred.

The scene/transform foundation, everyday editing, rich text/mentions, connectors,
media, document cards and full document/canvas embeds exist locally. The largest
remaining gap is production collaboration, followed by specific editing and
export capabilities. Preserve the tree, stable
Solid component identity and collaboration isolation while filling those gaps.

## Status against the original goals

| Goal | Current state | Remaining boundary |
| --- | --- | --- |
| Pure TypeScript core | Document/tree, geometry, operations, selection and history are in `packages/graphics`; no DOM, Solid, Zod or Loro dependency in the root export | SyncService coordination remains deferred; versioned JSON saves are wired in Canvas Next |
| Solid items and reactivity | Keyed Solid renderers remain; reordering preserves mounts. Geometry rendering/queries use immutable snapshots to reuse caches; UI consumers retain the reconciled store | Broad session updates and whole-document validation still exist; no general incremental scene index or culling |
| Multiple graphic apps | Canvas Next uses the shared core | Additional products such as image markup, slides and design are unstarted |
| Typed feature contributions | Explicit shape definitions, renderer registry, typed commands and separate gesture contracts; extension recipe documented | Registry is centrally compiled; per-host core feature composition and runtime plugins are not implemented |
| TypeScript owns types | Explicit TS model and runtime validation; text is stored as a string | Canvas Next owns Lexical codecs and legacy schema migration; graphics treats text as opaque |
| Loro/SyncService path | Optional LoroTree backend, native local undo, ephemeral awareness, whole-string text and asset/reference mapping have tests | Canvas Next uses whole-file versioned JSON saves; real transport, collaborative recovery and durable Loro initialization remain open |

Recent completed work: shared Toolbar/Phosphor controls and standard context menu;
interactive document cards with loading skeletons; em-sized mention decorators;
no extra outline while editing text; cached pencil geometry during navigation and
transform previews; centered Fit Scene that zooms in/out to the current viewport
with 100 screen pixels per side on the limiting axis (within camera zoom limits).
Canvas Next documents use version 2 JSON through the existing storage endpoint.

## 1. Legacy Canvas parity

“Missing” means absent from the new graphics package and Canvas Next. A type
in the legacy schema alone does not count as a working user feature.

| Capability | Legacy Canvas evidence | New graphics status | Work owner |
| --- | --- | --- | --- |
| Infinite view, pan/zoom, fit | RenderState, CanvasController, zoom/center controls | Present; Fit Scene centers full geometry and fits current viewport with 100px margins | Graphics browser adapter; Canvas controls |
| Touch navigation | CanvasController uses pinch gestures | Multi-touch missing | Graphics browser adapter |
| Click, multiselect, marquee, move, resize, delete | Selection and operation modules | Present; shape-aware click-through and transform modifiers added | Graphics core |
| Grouping and layer actions | Group records, reorder module, render queue | Present with a real transform tree, reparenting and stable sibling ordering | Graphics core |
| Rotation and nested transforms | No equivalent transform-tree/rotation model found | Present; preserve this foundation | Graphics core |
| Undo/redo | Snapshot history | Present locally; Loro native local undo is covered by the peer harness | Core history boundary; optional Loro adapter |
| Rectangle and ellipse | Rectangle creation; ellipse schema/renderer support | Both creation tools present | Graphics shape modules and Solid renderers |
| Fill/stroke and richer appearance | Style model and floating controls: colors, line weight, corner rounding, text size; opacity rendering | Fill/stroke, stroke width, opacity and rectangle radius present; text font family/size and rich formatting present | Typed graphics style capabilities; Canvas inspector |
| Freehand drawing | Pencil operation, stored points and renderer | Pencil present: smoothed ink, mouse pressure simulation and pen pressure | Graphics path feature; browser sampling; Canvas tool |
| Lines/arrows/connectors | Free or node-bound endpoints, straight/stepped/smooth paths, endpoint styles | Present in Canvas Next: free/center/edge endpoints, legacy routes and heads, reconnect, reference lifecycle | Graphics connector/reference feature; Canvas controls |
| Text and shape labels | Lexical-backed text boxes; editable shape labels | Shared Markdown builder; serialized Lexical text/labels; whole-string LWW mapping present | Graphics geometry and opaque content contract; application-owned Lexical editing, validation, rendering and measurement |
| Clipboard | Copy/cut/paste nodes, edges, group remapping, text/images and Macro links | Shape/group/Lexical fragments, plain/HTML text, images and Macro document links present | Core fragment/remapping operations; browser clipboard; Canvas MIME policy |
| Select all and keyboard nudge | CanvasController and nudge module | Present; focus-scoped hotkeys, 1/10 world-unit nudges | Core selection/translate commands; browser shortcuts |
| Alignment | Six align actions for nodes/groups/free edges | Six align actions and equal-gap distribution present | Core geometry commands; Canvas inspector |
| General duplication | Copy/paste exists; no separate duplicate command found | Duplicate command and cancellable Option-drag present | Core clone/fragment command; Canvas action |
| Images as movable items | Image loading/upload/drop and DSSMedia | Movable image items with stable sources, upload/drop/paste and workspace picker | Graphics asset/image feature; host asset adapter |
| Video | Video node, media selection and rendering behind enabled-by-default flag | Present with workspace/upload sources and local playback | Optional media feature and Macro adapter |
| Macro entity cards and mentions | Documents, chats, projects and other entity references; Lexical mentions | Interactive DocumentPreview cards, full Markdown/legacy-canvas embeds, and shared mentions in text/labels present; other standalone entity cards pending | Canvas/Macro feature; generic graphics item/focus contract |
| Import and download | JSON load/save/download; SVG import path | Bidirectional legacy bridge is the next planned checkpoint; converter not implemented | Legacy compatibility adapter and Canvas host |
| Saving and reopening | Whole-document JSON saves to DSS; camera saved separately | Missing by design in prototypes | Persistence adapter and Canvas document host |
| Permissions, sharing and document shell | canEdit, sharing, file actions, location links, Ask Macro, block/drive hosts | Saved-document host is wired behind the rollout flag | Canvas/Macro host |
| Concurrent document editing | No Loro/SyncService canvas document path found; live avatars are not document sync | Loro two-peer experiment only, with ephemeral cursor/selection/gesture awareness | Optional collaboration adapter and host wiring |
| Toolbars, contextual controls, shortcuts | Legacy toolbar, floating inspector and shortcut bindings | Shared Toolbar/Phosphor tools, bottom-left navigation/history, floating inspectors/layers, standard context menu and focus-scoped Macro hotkeys | Canvas composition and browser bindings |

Legacy evidence: [model](../apps/web/src/features/block-canvas/model/CanvasModel.ts),
[controller](../apps/web/src/features/block-canvas/component/CanvasController.tsx),
[toolbar](../apps/web/src/features/block-canvas/component/ToolBar.tsx),
[inspector](../apps/web/src/features/block-canvas/component/FloatingMenu.tsx),
[clipboard](../apps/web/src/features/block-canvas/signal/clipboard.ts),
[alignment](../apps/web/src/features/block-canvas/signal/align.ts),
[text editor](../apps/web/src/features/block-canvas/component/nodes/TextBox.tsx),
[connectors](../apps/web/src/features/block-canvas/util/connectors.ts),
[file drop](../apps/web/src/features/block-canvas/signal/fileDrop.ts),
[saving/export](../apps/web/src/features/block-canvas/store/canvasData.ts),
[host controls](../apps/web/src/features/block-canvas/component/TopBar.tsx).

Caveats: image/text/file/video/SVG features have feature flags. HEIC defaults off.
The legacy `link` node and edge `label` fields do not establish complete renderer or
editing support; do not count them as implemented parity. Similarly, rotation,
general object snapping, distribution, frames, locks, an eraser and spatial
comments were not found as complete legacy features in this audit. Raster/SVG
export is a new target; the verified legacy download path downloads document data.

## 2. Excalidraw parity beyond that baseline

Core whiteboarding/content/export capabilities are established by the
[upstream feature list](https://github.com/excalidraw/excalidraw#features).
More detailed drawing contracts come from its
[element model](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts),
editing controls from its
[UI catalog](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/locales/en.json),
and integration/view-mode controls from its
[public props](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/).
The table distinguishes priority from evidence of availability.

| Additional capability | Current graphics gap | Recommendation / owner |
| --- | --- | --- |
| Diamond, editable lines and arrows | Lines/arrows and endpoint editing are present; diamond is approximated on Excalidraw import | Add a native diamond kind only if product requirements need it |
| Arrow binding and arrow labels | Center/edge bindings and connector labels are present | Arbitrary bend-point editing and remote endpoint awareness remain |
| Pressure-aware freehand and erasing | Pencil/pressure and whole-shape erasing are present | Point editing remains later work |
| Text layout, wrapping and container-bound text | Auto-width/wrapped text, font scaling, and rectangle/ellipse/connector labels are present | Measurement/editing remain outside pure core |
| Stroke variants, fill patterns, roundness, opacity | Width, dashed/dotted strokes, roundness and opacity are present; fill patterns are missing | Optional painter for sketch/pattern styles |
| Duplicate/Alt-drag, flip, style copying | Duplicate/Alt-drag and flip actions are present; style copying is missing | Canvas gestures/menus |
| Align/distribute and object/grid snapping | Align/distribute, grid and angular snapping are present; object snapping is missing | Shared geometry/session features; Canvas policy and guides |
| Lock/unlock and view mode | No item locks; limited browser editing toggle | Explicit edit eligibility in graphics; permission policy in host |
| Frames, clipping and frame membership | Groups exist but do not clip | Add after mixed content; useful to slides/design too |
| Image crop and flip | Flip through resize-zero is present; crop pending | Image geometry crop extension |
| Export PNG/SVG/clipboard and editable files | Missing | Separate exporters; Canvas download/share UX |
| Reusable libraries | Missing | Core fragment insertion; Canvas library UI/storage |
| Links and web embeds | Rich-text links and Macro document/legacy-canvas embeds present; arbitrary web embeds missing | Typed optional items/references; host navigation and embed security |
| Find text, tool locking, context menus and shortcut discoverability | Basic context menu and Macro hotkeys present; find/tool lock missing | Canvas workflow; reusable query/input pieces as needed |
| Laser and following another peer | Missing | Later collaboration/presentation add-ons; never durable scene state |
| Real network collaboration and recovery | In-memory replica/awareness test harness only | Production adapter milestone; reuse Macro collaboration infrastructure |
| Local saving and share links | Versioned JSON saving is wired | Collaboration-backed persistence and recovery remain |

Newest upstream UI/model entries also include sticky notes, lasso, draw-to-shape,
bucket fill, diagram generation and AI workflows. Treat these as a separate
evaluation backlog, not automatic requirements for the next milestones. Likewise,
Excalidraw.com's PWA/encryption features do not dictate Macro's storage/security
architecture. Match useful user behavior without copying Excalidraw's element model:
its group membership/frame references are not our nested local-transform tree.

## 3. What belongs in graphics

Keep a small pure kernel plus explicitly imported feature modules. “Graphics” also
has optional browser, Solid, persistence and collaboration adapters; these are not
permission to put browser or service dependencies in the root export.

| Priority | Shared capability | Concrete work |
| --- | --- | --- |
| A1 baseline built | Typed command/feature boundary | Pure typed command payloads/results and one validated commit per command. Richer command availability and history grouping remain extensions; avoid app-specific editor methods. |
| A1/A2 built | Editing primitives | Select all, translate/nudge, duplicate, fragment extraction/insertion, ID/reference remapping, alignment and distribution. Preserve nested world pose and selected-root normalization. |
| A2 built | Appearance capabilities | Stroke width, opacity, corner radius and explicit resize-versus-scale behavior; group styling edits leaves. Stroke variants/patterns remain future capabilities. |
| Early | Interaction eligibility | Lock/visibility semantics in hit tests, selection and mutations; read-only command gating. Canvas permissions supply policy but core commands must honor it. |
| Built locally; ownership cleanup next | Text geometry and content contract | Text boxes, wrapping/scaling, shape-label layout and injected measurement exist. Core should retain only opaque string content and geometry; move existing Lexical JSON validation, seed construction and empty-content detection into the application. Whole-string LWW belongs to the optional collaboration adapter. |
| Built baseline; extend incrementally | Path and connector features | Pencil ink and free/bound connectors, legacy routing/heads, endpoint editing and reference lifecycle exist. Connector labels, arbitrary bends and endpoint awareness remain. |
| Built baseline; crop later | Assets and images | Stable image/video/document references and geometry exist. Crop remains absent; loading, URLs, decoding, progress, uploads and embed focus stay in adapters. |
| Early | Snapping and editing scopes | Pure snap candidate/constraint calculations; session-only guides. Explicit enter/exit group scope and consistent nested selection. |
| Later | Frames and surfaces | Clipping, frame bounds and policies, then multiple ordered surfaces when slides need them. Groups continue to mean transform containment without clipping. |
| Later | Spatial anchors | Item-local/world anchors for comments and annotations; thread content remains external. Numbered callouts are an optional annotation feature. |
| Targeted fix built; broader measurement next | Incremental queries and projection | Pencil ink caches now survive pan/hover/selection/move/rotation previews. Measure mixed-content scenes before adding affected-item subscriptions or spatial queries/culling. Pin active text/media; never derive saved membership from mounted content. |

The extension boundary remains explicit and centrally compiled. `ShapeDefinition`
handles geometry/validation/deep freezing; `core/drawing.ts` owns typed box and
sampled pencil gestures. Loro pose geometry accepts typed shape payloads, and
presence can carry pencil samples. Brush settings remain internal. Introduce
further typed contributions as non-box features arrive, including their optional
collaboration mapping and preview rendering. Avoid a
generic untyped properties bag or a runtime plugin marketplace.

Preserve layering as an acceptance gate for every new renderer: one document paint
order for all content, matching reverse hit order, stable keyed Solid mounts, and
separate editor overlays. Test text, image, path and connector overlaps, including
inside groups and after reordering. Embedded focus and portals must not alter
content order. Verify both visual stacking and DOM identity, not screenshots alone.

## 4. What belongs in Canvas and the adapters it composes

| Priority | Canvas capability | Boundary |
| --- | --- | --- |
| A1/A2 local composition built | A reusable Canvas composition | Preset of graphics features; toolbar, contextual inspector, colors/defaults, shortcuts and context menus. Demo pages mount the same composition. |
| Early | Comfortable whiteboarding | Hand/tool-lock modes, snap/grid switches, group-entry UX, zoom-to-selection, text placement, arrow editing and pencil/eraser interaction. Algorithms stay shared. |
| Early | Browser editing | Pointer/pen/touch, clipboard MIME negotiation, file drop, IME/focus delegation and measurement through graphics adapters. Canvas decides enabled workflows. |
| Early | Macro content | Entity cards, links, mentions and media; inject lookup, navigation and asset capabilities. Graphics never imports Macro services. |
| Before real documents | Document host | Create/open/save status, read-only permissions, share controls, location links, block/drive embedding and disposal. |
| Before real documents | Production persistence/collaboration | Bind document identity to the existing collaboration manager/engine/WAL/snapshot/SyncService infrastructure. Map feature data in the optional Loro adapter; attach actual peer identity and awareness transport. |
| Next checkpoint | Migration and interoperability | Bidirectional legacy JSON bridge with original-record preservation, fixtures and explicit compatibility diagnostics. Decide old-format saving versus explicit import/export and color policy. Export from authoritative data; do not version or persist test seeds. |
| After useful content | Export and libraries | Export menus, download/copy/share, saved selections/templates; graphics exporters and fragment commands supply reusable operations. |
| Product-specific | Comments and image markup | Comment threads, resolution, permissions and notifications in Macro; spatial anchors in graphics. Centered image navigation and markup tool presets remain a separate app composition. |
| Later | Presentation/design workflows | Slides UI, frame navigation, DOM layout, reusable components and constraints when those products are started. Reserve interfaces without implementing them all now. |

Lexical belongs to the application layer, including its node vocabulary, shared
Markdown builder, serialization/validation, empty-content detection, editing,
rendering and DOM measurement. Graphics owns text/label geometry, transforms and
layout using an injected measurer. Its content contract should be an opaque,
size-bounded string, with no assumptions about JSON roots or Lexical nodes. The
application decides when an edit means deleting a text item or clearing a label.
Current core helpers and browser/Solid fallbacks still understand Lexical's tree;
extract that knowledge as part of the legacy bridge's application text codec.

Canvas Next's chosen payload remains a serialized Lexical string with whole-content
last-write-wins in the optional collaboration adapter. Text content is separate
from pose. Character-level merging and remote carets are not part of this checkpoint.
Test the chosen text adapter in the two-peer lab, including scene versus text undo
and focus restoration. Keep awareness/spring animation receiver-local and optional.

The Loro checkpoint is evidence, not a production-readiness claim: parent/pose
conflicts can leave a node world-anchored until its next edit; incoming commits
cancel active gestures; native undo has documented conflict/deletion behavior.
Decide those policies before real documents. No need to wait for complete tool
parity to exercise the production adapter, but do not bypass text/asset schema tests.

## 5. Recommended checkpoint sequence

Each checkpoint stays small enough for hands-on iteration. These are proposals,
not authorization to implement all features at once.

| Checkpoint | Graphics work | Canvas work | Exit condition |
| --- | --- | --- | --- |
| A1: everyday editing (implemented) | Minimal command contribution pattern, select all, nudge, duplicate, fragment copy/paste | Shortcut/context-menu wiring | Copy a nested group, move it, reorder it and undo; correct IDs/pose/order in memory and Loro. |
| A2: styling and arranging (implemented) | Stroke width, opacity, radius, align/distribute, explicit group style policy | Inspector controls and defaults | Mixed selection styling and arrangement form predictable undo steps; picking matches visible strokes. |
| Pencil (implemented ahead of text) | Raw local samples, private perfect-freehand brush, ink picking/bounds, regeneration on resize | P tool, repeated strokes, pen input, single-stroke undo | Stroke transforms, copies and syncs; empty ink gaps click through; brush stays outside document schema. |
| B: text (local implementation and LWW mapping built; ownership cleanup pending) | Text geometry, injected measurement, text/pose separation and whole-string Loro tests; remove Lexical-format assumptions | Application-owned Lexical codec/validation, shared Markdown builder, text tool, rich shape labels, mentions and text/scene undo routing | Local editing works; finish the application boundary with the legacy bridge. Full-editor two-peer focus/history testing remains deferred. |
| C1: lines (baseline implemented) | Path geometry, free endpoints, arrowheads, endpoint editing | Line/arrow tools | Paths select, transform, layer, copy and undo alongside text/shapes. Arbitrary bend editing remains separate. |
| C2: connected diagrams (bindings/routing implemented; labels and remote endpoint previews pending) | Bindings, target geometry, deletion/reference rules | Connect/reconnect UX and labels; routing styles incrementally | Nested target move/rotate/reparent and concurrent target deletion converge with valid endpoints. |
| D1: media and document content (baseline implemented) | Image/video/document kinds, stable references and Loro round-trip tests | Paste/drop/upload/workspace picker, clickable preview cards, full document/legacy-canvas embeds | Local insert/transform/copy/undo and reset-during-upload tests exist. Broader mixed-content layering/focus and interrupted-asset scenarios remain integration gates. |
| D2: markup and drawing (partial) | Pencil input built; annotation anchors/export still missing | Comments and richer markup are not implemented | A future centered-image host should reuse the same core; annotation-specific UX is a later checkpoint. |
| Interaction/performance polish (implemented 2026-09-28) | Immutable geometry cache reuse during pan/hover/selection and move/rotation previews; viewport-based scene fit | Shared controls/context menu, text-edit outline cleanup, centered fit with 100px margins | Targeted pencil regression and browser checks pass; broad mixed-scene performance remains unmeasured. |
| E: whiteboard polish | Snap constraints, edit eligibility, frames/clipping incrementally | Guides, locks, frames, touch, crop, eraser, libraries and exports | A useful Excalidraw-style board; mixed-content layering and responsiveness remain stable. Split this into individual feature checkpoints. |
| Production gate | Finalize feature mappings/conflict behavior and import validation | Durable document host, existing sync infrastructure, permissions, recovery and legacy import | Reopen, offline/reconnect, duplicate delivery, asset failure and read-only tests pass before replacing old Canvas. Can proceed alongside later polish. |

Pencil, text/mentions, connectors and media have advanced beyond A2. The chosen
text policy is whole-string LWW; a character/mark CRDT is not planned. Keep the
headless shape and peer fixtures focused while bringing integration coverage into
the full Canvas Next composition.

## 6. Next checkpoints to choose from

User priority (2026-09-28): build the old → new → old data bridge, then settle
the canvas color model. Full peer support is deferred. See the
[bridge audit and implementation slices](CANVAS_LEGACY_BRIDGE.md). The N1–N3
sequence below is retained as later integration work, not the immediate plan.
P1/P2 remain smaller whiteboarding alternatives.

| Checkpoint | Scope and owner | Done when |
| --- | --- | --- |
| **Next: old → new → old bridge** | Host-owned legacy conversion, original-record preservation, text codec and explicit unsupported-feature diagnostics. First settle old-format saving versus import/export. | Common-subset fixtures round-trip IDs, geometry, effective order, bindings, text and media; a comparison harness shows both renderers; unrepresentable edits cannot silently corrupt saves. |
| **Then: canvas colors** | Decide fixed artwork colors versus a canvas-specific adaptive palette; separate app chrome from saved paints and define legacy/export projection. | Imported hex colors survive exactly; theme changes follow the chosen policy; custom alpha/no-paint and opacity are unambiguous. |
| **N1: full Canvas Next two-peer lab (deferred)** | Compose the existing Canvas view with injected editors/backends, actual rich-text measurement/renderers, clipboard and optional presence. Give new kinds typed ghosts or intentional bounds previews; handle connector endpoint drafts. Keep transport in memory and seeds disposable. Core changes only for demonstrated semantic gaps. | Both peers can edit a mixed scene with text/mentions/labels, pencil, bound connectors and media/card references. Text-versus-move and conflicting whole-string edits behave as specified; local undo preserves unrelated remote edits; focus, stacking and keyed mounts survive. Offline/reconnect and delayed commits work. Measure pan/select/drag in this mixed fixture; no network service or persistence required. |
| **N2: read-only and locked items** | Core edit eligibility shared by commands, hit testing and gestures; Canvas exposes lock/unlock and injects host edit permission. | Pointer, hotkeys, paste/drop, text editing and async insertion all respect read-only state. Locked items cannot be mutated through alternate input paths. Navigation and explicitly allowed links remain usable. |
| **N3: durable new-document host** | Finalize conflict/initialization contracts; connect newly created Canvas Next documents behind an opt-in host to the existing collaboration manager, engine, WAL, snapshots and SyncService. Follow the spreadsheet session's recovery/disposal patterns. Audit server routing before promising no backend work. | New documents reopen, recover offline edits, handle duplicate delivery/storage failure and report local-versus-remote save status. Permissions work. Legacy documents still use the old host; migration/import is a separate reviewed checkpoint. |
| **P1: connector labels (implemented)** | Graphics attachment/layout/edit commands plus Canvas's existing rich-text editor, clipboard, deletion and whole-string LWW mapping. | Labels follow connectors, survive rerouting/copy/undo and round-trip through the peer harness. |
| **P2: object snapping and guides** | Pure snap candidates/constraints in graphics; session-only guides and modifier policy in Canvas. Start with movement. | Centers/edges snap at a constant screen-space tolerance under zoom/nesting; temporary bypass, cancellation and undo remain predictable. |

Build the bidirectional legacy bridge before expanding peer support; production
cutover and SVG/PNG export remain separate gates. Frames, crop, eraser, touch, comments, libraries and slides/design are still
backlog; do not combine them into one large polish milestone. Keep the current
test fixtures unversioned and unsaved when a real document host is introduced.

Why N1 remains useful later: the core mapping has automated coverage for new content,
but the in-memory harness has not exercised the full rich editor, asset views or
embed focus together.
That is a smaller architectural checkpoint than production sync and directly tests
the boundary needed for it. Embeds retain their own document permissions/sync;
outer-scene collaboration synchronizes references and presentation only.

## Verification record (2026-09-28)

- Latest full graphics suite: 232 passing tests across 35 files; Canvas Next: 20
  passing tests across 5 files. Graphics and web TypeScript checks passed during
  the performance checkpoint; `just check` passed with existing warnings.
- Latest Fit Scene change: 32 relevant tests and graphics type checks passed;
  browser measurements confirmed 100px margins on both width- and height-limited
  scenes, centered in the actual viewport and able to zoom above 100%.
- Pencil regression uses 11 strokes/7,041 input samples: zero additional brush
  builds during hover/pan/selection/move/rotation previews; resize and stroke-width
  changes rebuild ink. Browser checks covered move, selection, pan, resize and undo.
- These are scoped checks from the implementation work, not a fresh full-product,
  mixed-content performance, production recovery or upstream parity certification.

## Current implementation references

- [Graphics package and present limits](../packages/graphics/README.md)
- [Model](../packages/graphics/src/core/model.ts), [shape contract](../packages/graphics/src/core/shapes/definition.ts), [editor](../packages/graphics/src/core/editor.ts)
- [Browser input](../packages/graphics/src/browser/index.ts), [Solid rendering](../packages/graphics/src/solid/index.tsx)
- [Loro mapping](../packages/graphics/src/loro/scene-mapping.ts), [collaboration limits](../packages/graphics/src/loro/README.md)
- [Original architecture](CANVAS_ARCHITECTURE.md), [scene foundation](GRAPHICS_SCENE_FOUNDATION.md)

### Text storage and embedded-items checkpoint (2026-09-25)

Canvas Next now uses the shared Markdown builder and stringified Lexical states
for text and labels. Loro treats each completed content value as one LWW string.
Image/video items support upload, existing workspace sources, drop/paste,
transforms, styling, clipboard and undo. Document items render the shared
DocumentPreviewContent as raised, interactive cards with fixed base text sizing.
Markdown documents and existing canvases also support full embeds with explicit
Interact/Done input ownership. Embedded editors use their existing permissions and
sync; only a stable reference and presentation mode are stored in graphics.
SVG is inserted as an image; editable SVG import/export and production sync remain
future work. No document-version migrations or local storage were added.

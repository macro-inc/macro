# Graphics and Canvas parity plan

Source audit: 2026-09-24; connector checkpoint updated 2026-09-25. This compares the current working tree, including the
uncommitted graphics prototypes, with legacy `block-canvas` and upstream open-source
Excalidraw. It is a planning inventory, not a fresh runtime certification of every
legacy feature. Excalidraw master may lead the deployed app; Plus-only product
features are outside the baseline. Priorities below are recommendations.

A1 and A2 are now implemented in the local [Canvas Next demo](../apps/web/src/features/block-canvas/canvas-next/README.md)
at `/app/component/canvas-next`, gated by `USE_CANVAS_NEXT`. It uses fresh in-memory
seed data and leaves the legacy Canvas document host intact. This is not a production
sync or legacy-import checkpoint.

The scene/transform foundation and everyday editing exist. The largest gaps are
useful content types and production document integration. Preserve the tree, stable
Solid component identity and collaboration isolation while filling those gaps.

## 1. Legacy Canvas parity

“Missing” means absent from the new graphics package and its playgrounds. A type
in the legacy schema alone does not count as a working user feature.

| Capability | Legacy Canvas evidence | New graphics status | Work owner |
| --- | --- | --- | --- |
| Infinite view, pan/zoom, fit | RenderState, CanvasController, zoom/center controls | Present for desktop; image demo has centered zoom | Graphics browser adapter; Canvas controls |
| Touch navigation | CanvasController uses pinch gestures | Multi-touch missing | Graphics browser adapter |
| Click, multiselect, marquee, move, resize, delete | Selection and operation modules | Present; shape-aware click-through and transform modifiers added | Graphics core |
| Grouping and layer actions | Group records, reorder module, render queue | Present with a real transform tree, reparenting and stable sibling ordering | Graphics core |
| Rotation and nested transforms | No equivalent transform-tree/rotation model found | Present; preserve this foundation | Graphics core |
| Undo/redo | Snapshot history | Present locally; Loro native local undo in the peer demo | Core history boundary; optional Loro adapter |
| Rectangle and ellipse | Rectangle creation; ellipse schema/renderer support | Both creation tools present | Graphics shape modules and Solid renderers |
| Fill/stroke and richer appearance | Style model and floating controls: colors, line weight, corner rounding, text size; opacity rendering | Fill/stroke, stroke width, opacity and rectangle radius present; text font family/size and rich formatting present | Typed graphics style capabilities; Canvas inspector |
| Freehand drawing | Pencil operation, stored points and renderer | Pencil present: smoothed ink, mouse pressure simulation and pen pressure | Graphics path feature; browser sampling; Canvas tool |
| Lines/arrows/connectors | Free or node-bound endpoints, straight/stepped/smooth paths, endpoint styles | Present in Canvas Next: free/center/edge endpoints, legacy routes and heads, reconnect, reference lifecycle | Graphics connector/reference feature; Canvas controls |
| Text and shape labels | Lexical-backed text boxes; editable shape labels | Shared Markdown builder; serialized Lexical text/labels; whole-string LWW mapping present | Graphics text contract; browser/Solid editing; Canvas integration |
| Clipboard | Copy/cut/paste nodes, edges, group remapping, text/images and Macro links | Shape/group/Lexical fragments, plain/HTML text, images and Macro document links present | Core fragment/remapping operations; browser clipboard; Canvas MIME policy |
| Select all and keyboard nudge | CanvasController and nudge module | Present; focus-scoped hotkeys, 1/10 world-unit nudges | Core selection/translate commands; browser shortcuts |
| Alignment | Six align actions for nodes/groups/free edges | Six align actions and equal-gap distribution present | Core geometry commands; Canvas inspector |
| General duplication | Copy/paste exists; no separate duplicate command found | Duplicate command and cancellable Option-drag present | Core clone/fragment command; Canvas action |
| Images as movable items | Image loading/upload/drop and DSSMedia | Movable image items with stable sources, upload/drop/paste and workspace picker | Graphics asset/image feature; host asset adapter |
| Video | Video node, media selection and rendering behind enabled-by-default flag | Present with workspace/upload sources and local playback | Optional media feature and Macro adapter |
| Macro entity cards and mentions | Documents, chats, projects and other entity references; Lexical mentions | DocumentPreview cards present; other entity types/mentions pending | Canvas/Macro feature; generic graphics item/focus contract |
| Import and download | JSON load/save/download; SVG import path | Missing; disposable seeds only | Import/export adapters and Canvas menus |
| Saving and reopening | Whole-document JSON saves to DSS; camera saved separately | Missing by design in prototypes | Persistence adapter and Canvas document host |
| Permissions, sharing and document shell | canEdit, sharing, file actions, location links, Ask Macro, block/drive hosts | Registry demos only | Canvas/Macro host |
| Concurrent document editing | No Loro/SyncService canvas document path found; live avatars are not document sync | Loro two-peer experiment only, with ephemeral cursor/selection/gesture awareness | Optional collaboration adapter and host wiring |
| Toolbars, contextual controls, shortcuts | Legacy toolbar, floating inspector and shortcut bindings | Minimal demo controls; keyboard currently covers navigation, cancellation, delete and history | Canvas composition and browser bindings |

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
| Diamond, editable lines and arrows | Lines/arrows present with endpoint editing; diamond missing | Early graphics feature modules; Canvas tools |
| Arrow binding and arrow labels | Center/edge bindings present; connector labels missing | Early graphics reference/attachment semantics; text UI in adapters |
| Pressure-aware freehand and erasing | Pencil/pressure present; eraser missing | Eraser and point editing later; geometry in graphics |
| Text layout, wrapping and container-bound text | Auto-width/wrapped text, font scaling, and rectangle/ellipse labels present | Early text feature; measurement/editing outside pure core |
| Stroke variants, fill patterns, roundness, opacity | Width, roundness and opacity present; variants/patterns missing | Basic styles early; optional painter for sketch/pattern styles |
| Duplicate/Alt-drag, flip, style copying | Duplicate/Alt-drag present; flip/style copying missing | Core commands; Canvas gestures/menus |
| Align/distribute and object/grid snapping | Align/distribute and angular snapping present; object/grid snapping missing | Shared geometry/session features; Canvas policy and guides |
| Lock/unlock and view mode | No item locks; limited browser editing toggle | Explicit edit eligibility in graphics; permission policy in host |
| Frames, clipping and frame membership | Groups exist but do not clip | Add after mixed content; useful to slides/design too |
| Image crop and flip | Flip through resize-zero is present; crop pending | Image geometry crop extension |
| Export PNG/SVG/clipboard and editable files | Missing | Separate exporters; Canvas download/share UX |
| Reusable libraries | Missing | Core fragment insertion; Canvas library UI/storage |
| Links and web embeds | Missing | Typed optional items/references; host navigation and embed security |
| Find text, tool locking, context menus and shortcut discoverability | Basic context menu and Macro hotkeys present; find/tool lock missing | Canvas workflow; reusable query/input pieces as needed |
| Laser and following another peer | Missing | Later collaboration/presentation add-ons; never durable scene state |
| Real network collaboration and recovery | In-memory replica/awareness demo only | Production adapter milestone; reuse Macro collaboration infrastructure |
| Local saving and share links | Disposable scenes only | Host persistence/sharing; retain disposable playgrounds |

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
| Early | Text feature | Content and layout contract, text bounds, wrapping/auto-size, attachment to shapes/connectors, begin/end editing and undo ownership. Inject measurement; keep Lexical/DOM out. |
| Early | Path and connector features | Points/segments, picking, bounds and editing; bound endpoints with fallback coordinates. References are separate from containment. Specify delete, duplicate, reparent and undo behavior. |
| Early | Assets and images | Stable asset references and intrinsic metadata, image node geometry and crop. Loading handles, URLs, decoding, progress and uploads remain adapter state. |
| Early | Snapping and editing scopes | Pure snap candidate/constraint calculations; session-only guides. Explicit enter/exit group scope and consistent nested selection. |
| Later | Frames and surfaces | Clipping, frame bounds and policies, then multiple ordered surfaces when slides need them. Groups continue to mean transform containment without clipping. |
| Later | Spatial anchors | Item-local/world anchors for comments and annotations; thread content remains external. Numbered callouts are an optional annotation feature. |
| Measured | Incremental queries and projection | Benchmarks for mixed scenes, affected-item subscriptions, spatial queries/culling when needed. Pin active text/media; never derive saved membership from mounted content. |

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
| Before replacement | Migration and interoperability | A separate legacy JSON importer with fixtures and explicit unsupported-content reports. Export from authoritative document data. Add format versions only at durable/exchange boundaries; do not version or persist test seeds. |
| After useful content | Export and libraries | Export menus, download/copy/share, saved selections/templates; graphics exporters and fragment commands supply reusable operations. |
| Product-specific | Comments and image markup | Comment threads, resolution, permissions and notifications in Macro; spatial anchors in graphics. Centered image navigation and markup tool presets remain a separate app composition. |
| Later | Presentation/design workflows | Slides UI, frame navigation, DOM layout, reusable components and constraints when those products are started. Reserve interfaces without implementing them all now. |

The chosen text policy is a serialized Lexical string with whole-content
last-write-wins. Text content is separate from pose. Character-level merging and
remote carets are not part of this checkpoint.
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
| B: text (standalone and shape labels local; collaboration pending) | Typed text data, sizing/measurement/editing contracts | Text tool, inline editor, shape labels | Text keeps focus through unrelated updates/reorder; two-peer text/scene undo behavior is specified and tested. Start with a small text feature, then restore Macro formatting/mentions. |
| C1: lines (implemented) | Path geometry, free endpoints, arrowheads, point editing | Line/arrow tools | Paths select, transform, layer, copy and undo alongside text/shapes. |
| C2: connected diagrams (bindings/routing implemented; labels and remote endpoint previews pending) | Bindings, target geometry, deletion/reference rules | Connect/reconnect UX and labels; routing styles incrementally | Nested target move/rotate/reparent and concurrent target deletion converge with valid endpoints. |
| D1: images | Asset reference and image node | Paste/drop/load, resolve/upload adapter | Multiple image items layer correctly; no object URLs in documents; undo during upload cannot resurrect a deleted image. |
| D2: markup and drawing | Freehand path input; annotation anchors/export contracts | Pencil and image-markup composition; comments when ready | Same graphics features work in both whiteboard and centered image host. |
| E: whiteboard polish | Snap constraints, edit eligibility, frames/clipping incrementally | Guides, locks, frames, touch, crop, eraser, libraries and exports | A useful Excalidraw-style board; mixed-content layering and responsiveness remain stable. Split this into individual feature checkpoints. |
| Production gate | Finalize feature mappings/conflict behavior and import validation | Durable document host, existing sync infrastructure, permissions, recovery and legacy import | Reopen, offline/reconnect, duplicate delivery, asset failure and read-only tests pass before replacing old Canvas. Can proceed alongside later polish. |

Pencil was pulled forward after A1/A2 for hands-on drawing iteration.
Standalone text and shape labels from **B: text** now run locally in Canvas Next.
Remaining B work is Macro-specific rich content and a character/mark collaboration
adapter with text-versus-scene undo tests. This tests the
feature boundary with a different kind of content before broadening the toolbox. Keep the existing shape,
nested-scene, image and peer demos as focused regression fixtures.

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

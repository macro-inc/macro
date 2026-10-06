# Graphics

Experimental graphics editor with a framework-independent scene tree.

For a short implementation-based reference, start with the
[Graphics API guide](../../docs/GRAPHICS_API.md).

Status reviewed 2026-09-28. The [parity plan](../../docs/GRAPHICS_PARITY.md) is the
progress/next-checkpoint index. Canvas Next now includes rich text/mentions,
shape labels, connectors, media, document cards and full embeds behind its rollout
flag. The Loro adapter remains experimental; production persistence is not wired.
The next product checkpoint is a
[legacy bridge and color policy](../../docs/CANVAS_LEGACY_BRIDGE.md), kept outside
the pure core. Expanding peer support is deferred.

- `@macro-inc/graphics`: document, affine math, scene queries, selection, editing,
  validation and local history. No DOM, Solid, app or Loro imports.
- `@macro-inc/graphics/browser`: pointer capture, keyboard and wheel input.
- `@macro-inc/graphics/solid`: read-only reactive projection and keyed renderers.
- `@macro-inc/graphics/loro`: optional Loro backend and presence APIs. The
  in-memory peer transport lives in test support only.
- `@macro-inc/graphics/loro/solid`: optional awareness rendering and smoothing.

## Scene contract

Documents have one surface root and a normalized node map. Shapes
and groups have one authoritative `placement: { parentId, sortKey }` and a local
affine `transform: [a,b,c,d,e,f]`. Rectangles and ellipses own local width/height and appearance. Pencil owns raw
local `[x, y, pressure]` samples and `simulatePressure`; ink is derived.
Groups own no intrinsic geometry; their bounds come from descendants. Child lists
and paint order are derived from case-sensitive fractional string keys allocated
by [fractional-indexing](https://github.com/rocicorp/fractional-indexing).
Use `sortKeysBetween(lower, upper, count)` to create keys; null means an open end.
Keys must be unique among siblings; different parents may reuse keys. Comparison
uses code-unit ordering, never locale-sensitive sorting. Rendering and reverse
hit testing consume the same depth-first scene order.
Flat scenes are ordinary trees with shapes directly under the surface. Additional
typed kinds are text, connector, image, video and document; their feature contracts
are documented below. Shape labels are owned by rectangle, ellipse or connector
geometry.

Matrices use column vectors: x'=a*x+c*y+e, y'=b*x+d*y+f. World transforms compose
parent * local. Positive rotation is clockwise; angles are radians. Core queries
own coordinate conversion, inverse transforms, transformed corners, polygon
intersection and topmost hits. Invalid roots, cycles, missing/leaf parents,
nonfinite or noninvertible local/world transforms and invalid dimensions are rejected
before an atomic document commit.

`createScene` accepts only current typed nodes. Schema versions, legacy formats and
migrations belong to durable host boundaries such as Canvas Next.

## Editing

The editor composes the selection feature through its explicit `SelectionHost`
contract. Selection, box previews and transform overrides are session state.
Creation, move, rotation, resize, grouping, ungrouping, reparenting and subtree
deletion commit once, with bounded 100-entry local undo/redo. Navigation and
selection never enter history. Invalid operations make no partial changes.

Local history stores reversible item deltas: each entry references only the items
added, removed or replaced, plus changed root/surface metadata. Unchanged immutable
items and geometry are shared across commits; moving a pencil stroke retains its
existing samples. Undo/redo applies the whole delta atomically and restores the
original item references. No document snapshots are retained by the stacks.
Validation still checks scene-wide containment, ordering and connector invariants.
The optional backend owns its own history; Loro continues using its UndoManager.

`fitScene(viewport)` centers the full scene's world bounds and zooms in or out
until the first axis fills the current viewport with 100 screen pixels per side.
It respects camera zoom limits and reduces padding in small embedded viewports.
The host supplies its actual current dimensions; selection and current camera
offset do not influence the fit.

Group/reparent/ungroup preserve world transforms. Selected ancestors suppress
descendants as edit targets, preventing double movement/deletion. Mixed-parent
moves and pivoted rotation operate in world space, then convert back into each
parent's coordinates. `selectionFrame` is pure derived state shared by the Solid
overlay and the resize operation. One shape uses its full local-to-world frame;
a group or multiple roots always use a dashed world-axis-aligned box, regardless
of their rotation. Single shapes retain their local oriented solid outline.
Click-drag anywhere inside the selected box moves its selected roots, including
empty space and unfilled interiors. Shift and deep-select modifiers still pick
individual shapes. This does not change hit testing for unselected shapes.

Editors accept `snapUnit` in their options, with `getSnapUnit()` and
`setSnapUnit(unit)` for local configuration. Any positive finite scene-unit
interval is supported, including fractions; `undefined` disables snapping.
It is independent of camera zoom, document serialization and backend choice.
Changing the unit cancels active drawing/transform previews without adding history.
`CommandContext.snapUnit` and the pure `snapValue`, `snapPoint`, and
`snapTranslation` helpers let contributed commands use the same policy.

Rectangle/ellipse drawing and free connector endpoints snap positions. Moves,
nudges, duplicates and pasted fragments snap their common world-bounds anchor,
preserving internal spacing, pointer grab offsets and untouched axes. Resizing
snaps physical dimensions along the selection's axes, accounting for ancestor
scale. Proportional resizing snaps its controlling dimension while preserving
aspect ratio; center resizing keeps its center. Image boundaries, connector
bindings and angle/axis constraints take priority over the grid. Freehand samples,
rotation, equal distribution and exact alignment retain their own semantics.
Snapping does not round existing documents on load or remote updates.

The Solid surface's dot grid is camera-aware presentation: scene-unit intervals
1, 4, 16, 64, 256, etc. appear progressively as zoom increases. Fine dots fade in
from invisible at 4 screen pixels apart to full strength at 36; coarser dots stay
steady. At 800% individual canvas pixels are marked subtly at 12.5% opacity.
Three screen-space SVG patterns use fixed 1 px marks and crisp edges to avoid
resampling gradient tiles at fractional zoom. Each surface has unique pattern
IDs, and pattern count is independent of viewport size or dot count. All levels
share the scene origin and the caller's `gridColor`. The pure `dotGridLevels(scale)`
helper exposes those same intervals and opacities so hosts can choose a matching
snap unit. The surface itself does not change snap policy or document data.

Hold Shift during rotation to snap a single shape/group's world angle to 30° increments.
Hold Shift during movement to constrain the world-space delta to its dominant
horizontal or vertical axis, including nested selections and Option-drag duplicates.
Rectangle/ellipse drawing accepts `DrawingModifiers.proportional` to create a square
or circle; the browser maps Shift to it. The original pointer endpoint is retained,
so pressing/releasing Shift updates the preview immediately. Image-surface drawing
reduces both dimensions together when a constrained shape reaches the image edge.
Shift-click still toggles selection on release; crossing 3 screen pixels begins
a move instead. Shift-drag on empty canvas remains additive marquee selection.
Multiple selections snap the rotation delta while preserving relative angles.
The rotation circle sits 16 screen pixels outside a single shape's oriented top
edge, or above the world-aligned bounds for groups and multiple selections, with
no connecting stem. Single-shape resize adjusts local dimensions and placement while
keeping the opposite corner or edge midpoint fixed. Hold Shift to preserve the
original aspect ratio. Hold Alt/Option to resize from the original center;
Shift+Alt/Option combines both. Modifiers update even without pointer movement.

Invisible targets along each full edge also resize single shapes, multiple selections and groups.
Selected rectangles also have inset circular radius controls. `radius-nw/ne/se/sw`
gestures adjust the existing uniform `appearance.cornerRadius` in local shape units,
in whole-pixel steps independent of scene snapping, with a half-short-side clamp,
ephemeral preview, cancellation, and one
history commit. Geometry and pose stay unchanged. The controls follow affine parent
transforms while their visual size stays fixed on screen.
Each target spans 10 screen pixels across the edge at any zoom. Visible corner
handles take priority where they overlap the edge targets.
Handles stay square to the screen. Top/bottom edges use `ns-resize`; side edges use
`ew-resize`. Corners use `nwse-resize` or `nesw-resize` according to their world-space
quadrant relative to the selection center, including rotated or flipped shapes.
The chosen cursor stays visible during the drag preview.
Active gestures follow their pointer at the window level until release, even if
pointer capture is lost or the pointer leaves the canvas. Escape, pointer cancellation,
focus loss and disposal still discard previews; capture loss alone does not.
Left/right changes width; top/bottom changes height. Single-shape handles follow
the selection frame's axes. Perpendicular pointer motion is
ignored. Alt/Option anchors the center. Shift preserves proportions and centers
changes on the perpendicular axis, including when shrinking.

Shared corner and edge drags can stretch axes independently only when every
selected node and descendant has axes parallel to the frame (quarter turns are
compatible). Otherwise the entire gesture scales proportionally, keeping the
opposite anchor fixed and the content fitted to the box without adding shear.
Existing affine shear is preserved; shared resizing of such selections is uniform.

Nonuniform shared resizing uses `stretchShapes` to move leaf centers and resize
geometry, retaining group frames and placements. Crossing the opposite edge
reflects the leaf axes as well as their positions, so the contents truly flip.
Uniform resizing transforms selected roots once. Stroke width/radius stay local
dimensions during geometry resizing and scale with uniform root transforms.
Shapes opting into `regenerateOnScale` (pencil) instead absorb the added scale
into samples and compensate in their local pose, preserving nominal brush width.
Single and shared resizing continue through zero and invert each crossed axis.
Only a tiny minimum magnitude (1e-6 of the starting extent) keeps transforms
invertible at the exact crossing. Shift proportions and Alt/Option center anchors
apply on both sides of zero. Every gesture previews, cancels and commits once.

Grouping initially requires a common parent. Noncontiguous siblings become one
contiguous group at their earliest selected sibling position, which can change
stacking relative to unselected siblings. Ungroup splices children back in order.
Reparent takes a position: `'front'` (default), `'back'`, `{ before: siblingId }`
or `{ after: siblingId }`. It allocates a new key for the moved node. Grouping
retains child keys and places the group at the backmost selected key. Ungrouping
allocates new keys only for children released into the parent's order.

`reorderNodes(document, ids, 'front' | 'back' | 'forward' | 'backward')` and
`editor.reorderSelection(operation)` preserve selected nodes' relative order and
operate independently within each parent. Forward/backward move selected runs
past one unselected sibling; front/back move them to the ends. Only moved nodes
receive new keys; other siblings are never renumbered. Each command is one undo
step, with no history entry for a no-op. Groups remain contiguous subtrees.

These keys support stable local edits and serialization, not concurrent allocation
on their own. Duplicate sibling keys are rejected at the document boundary.
Concurrent inserts can generate the same key; the Loro adapter must resolve or
replace this allocation with ordered-tree positions before shared documents are
enabled. An isolated Loro experiment now exercises these cases; its mapping and conflict
policy are documented separately below.

Solid renders drawable IDs in tree paint order with computed world matrices.
Grouping/reparenting/reordering preserves keyed component identity. The surface
isolates its content stack from the app, each item wrapper isolates its renderer,
and editor overlays live above content. Renderers may layer their internal
children, but must keep document content inside their item wrapper; portals are
reserved for explicitly coordinated editor UI. Selection polygons,
a solid oriented box for a single shape, a dashed axis-aligned box for groups and
multiple selections, corner handles, invisible edge targets and rotation handles are drawn in a viewport overlay, so their
size is independent of ancestor scale/rotation. The shared box and handles hide
during transform previews; individual outlines remain visible. Selected shapes (including
selected groups' leaves) also get a one-screen-pixel selection-color trace along their
geometry: the pencil's streamlined centerline, rounded rectangle perimeter, or ellipse.
In groups or multiple selections, rounded rectangles and ellipses show only that
geometry trace inside the shared selection box, without individual rectangular boxes.
These non-interactive SVG traces use non-scaling strokes in the viewport overlay.
The Select tool previews the same trace on hover, using the exact pointer-down
target policy (3 screen px tolerance, click-through, group/deep selection, and
selected box interiors). Hover stays local to the browser/Solid adapter, repicks
after camera/document/modifier changes, and hides while dragging, panning or drawing.
It never enters core session state, history, persistence or collaboration awareness.
The scene tree does not require
a matching DOM tree.

## Boundaries and verification

One surface per document, a centrally compiled typed shape registry, linear scene
queries are deliberate prototype limits. Text,
connectors and embedded item contracts are implemented. Frames/clipping, layout,
multi-surface documents, per-host core registries and runtime plugin loading are not.
Affine reflection/shear compose correctly, but have no dedicated UI controls.
SyncService integration remains separate work. The two-peer Loro experiment uses
native local undo; never apply local item-delta undo to a shared document.

The [scene foundation specification](../../docs/GRAPHICS_SCENE_FOUNDATION.md)
describes the intended longer-term boundary and collaboration questions.
Run `bun run test` and `bun run type-check` here. Tests cover tree invariants,
transform math, document reset, pose preservation, nested editing, history, selection,
input routing and stable Solid mounts. The no-DOM compilation/import checks
enforce the pure TypeScript core boundary.

## Pencil

`shapes/pencil.ts` wraps `perfect-freehand` with private brush settings. Documents
store the raw local centerline and normalized pressure values, not SVG paths,
brush presets, timestamps, or generated bounds. Mouse strokes use spacing-based
pressure simulation; pen strokes retain hardware pressure. Resize scales samples
and regenerates the ink, including simulated pressure, without changing nominal
stroke width. Reflections and nested placement remain scene transforms.

Rendering, hit testing and selection bounds share the generated ink polygon.
The selected pencil's centerline highlight comes from the same brush calculation;
it does not trace the raw samples or the outer ink polygon.
Click tolerance is measured in world space after ancestor transforms; marquee
uses polygon/box intersection, so empty loops and unused bounds do not hit.
Immutable core geometries cache derived ink. The Solid projection exposes both
a reconciled store for fine-grained UI reads and a reactive immutable snapshot
for rendering and geometry queries. Pan, hover, selection, move and rotation
previews reuse cached ink; geometry or stroke-width changes regenerate it.
The keyed renderer emits one filled SVG path. Fill/radius have no pencil
meaning; stroke color, width and opacity control its ink.

Browser coalesced pointer samples are processed as a batch. Preview and commit
use the same brush endpoint policy to avoid a release-time change in shape.
One stroke creates one history entry; cancellation creates none. A tap creates
a dot. Samples are deeply frozen and limited to 16,384 per stroke; further samples
are ignored at this prototype limit. Point editing, erasing, straight segments,
compact point encoding and spatial indexing remain later work.

## Adding a shape

Shape registration is explicit and compile-time. There is no mutable global
registry or runtime plugin loading. Rectangle, ellipse and pencil follow the same path:

1. Add a pure module under `src/core/shapes/` exporting its geometry type and
   `ShapeDefinition<'kind'>`. Add the geometry type to `ShapeGeometryMap` in
   `model.ts`, then add the definition to the mapped registry in
   `shapes/registry.ts`. TypeScript checks the kind/definition pairing.
2. Implement geometry validation, deep freezing, local bounds, point hit testing,
   box intersection, resize and geometry equality. Bounds may have a nonzero local
   origin (pencil ink extends around its samples). `resize` scales geometry about
   the local origin without changing identity/placement/transform; the selection
   feature applies translation and reflection. A brush may regenerate its outline
   rather than making painted bounds fit the target box exactly. Opt into
   `regenerateOnScale` when uniform group scaling must also rebuild geometry.
3. Point picking receives a **local point**, the complete **world transform**,
   and a tolerance in **world units** (`3 / camera.scale`). Measure outline
   distance in world space to preserve screen tolerance through nested affine
   transforms. Marquee intersection uses the actual shape, regardless of fill.
4. Add a Solid component under `src/solid/shapes/` with
   `ShapeViewProps<'kind'>`, and register it in `defaultRenderers` in
   `solid/shape-renderers.tsx`. It receives a reactive item, effective scale and
   optional preview state. Hosts can supply typed overrides via `renderers`;
   image markup retains its rectangle renderer. The core never imports these.
   Register the geometry-only selection indicator in the typed `outlines` map in
   `solid/selection-outline.tsx`; it must use `non-scaling-stroke` and local geometry.
5. Add a typed acquisition gesture to `core/drawing.ts`, separate from the shape
   definition. Boxes collect two corners; pencil collects samples. Browser input
   calls `beginShape`, batched `updateDrawing`, `commitShape`, `cancelShape`;
   `getDrawingPreview(appearance)` produces the typed temporary shape.
   Rectangle aliases remain for the image host. Selection and rendering consume
   definitions and typed previews without shape-specific gesture branches.
6. Cover curve/interior picking, zoom tolerance, box intersection, invalid geometry,
   transforms and history, and verify the actual component and controls in-browser.

Ellipse performs analytic curve picking after transforming to principal axes;
marquee queries transform the box into ellipse-normalized coordinates. Neither
uses the ellipse's bounding rectangle as its hit area. Selection handles still
use the local bounding rectangle, as they do for other bounded shapes.

This checkpoint proves typed shape modules, not a general-purpose extension API:
text and connector gestures now have explicit feature contracts; layout, per-host
core registry composition and dynamic plugins remain future work. Schema versioning and
import/export boundaries can be introduced when real persistence is needed.

## Typed commands and everyday editing

`GraphicsCommand<Payload>` is a pure contribution with `id` and
`apply({ document, selection }, payload)`. Return a proposed document and optional
selection. `editor.execute(command, payload)` validates the proposal and makes one
history step; returning the original document is a no-op. The command receives no
Solid, browser, persistence or collaboration objects. Inject ID factories in the
payload for operations that allocate nodes.

Built-ins: `selectAllCommand`, `nudgeCommand`, `duplicateCommand`, `pasteCommand`,
`styleCommand`, `alignCommand`, and `distributeCommand`. `copyFragment` extracts
selected subtrees in paint order, with root transforms expressed in world space.
`parseFragment` validates bounded clipboard input; `pasteFragment` remaps every ID
and reconstructs local transforms in the destination parent. Canvas supplies OS
clipboard and shortcut policy. See the [Canvas Next notes](../../apps/web/src/features/block-canvas/canvas-next/README.md).

Groups have no inherited appearance. Styling a group updates its leaves. Stroke
width (default 2), opacity (1), and rectangle radius (0) are optional typed fields;
`resolveAppearance` supplies defaults. Width/radius use local units and scale with
the node transform. The Loro adapter writes each style field independently so local
undo of one property preserves a peer's edit to another.

The Solid renderer calculates one world-space offset for ordinary move previews
and applies CSS translation only to moving wrappers and outlines. Selected shapes
(including group descendants) retain their keyed mounts, geometry, and flat paint
order. Content and unselected shapes do not receive pointer updates. Connectors
retain their live geometry path so bindings track moving ends.
Resize/rotation and committed document changes use the regular projection. Shape
renderer `item` props are live views: read their fields in reactive scopes, as with
Solid props, rather than relying on the outer object's identity changing. Nested
geometry and appearance retain their immutable identities for core caches.

`beginTransform` optionally takes an ID factory to preview subtree duplication.
Its session-only preview document includes new nodes; the durable document remains
unchanged until a moved gesture commits. Cancellation discards the preview and
restores the previous selection. Solid keeps original keyed mounts intact.

## Loro adapter

The in-memory peer harness gives tests two real Loro replicas with independent
selection, camera and local undo. See [the adapter notes](src/loro/README.md) for
its ordered tree mapping, geometry conflict policy, limitations and validation cases.

The optional `@macro-inc/graphics/loro/solid` wrapper adds colored peer cursors,
selection outlines and ghosts of pending drawing/move/resize/rotation gestures.
Awareness uses a separate ephemeral channel: it never enters the document, local
selection, hit testing or undo. Disconnect clears remote overlays; reconnect sends
fresh presence. The core and ordinary browser/Solid surfaces do not depend on it.

### Rich text

`text` is an explicit shape kind. `TextGeometry.content` is a host-defined opaque
string; geometry also stores measured width/height, typography and auto-width.
Core checks only that content is a string of at most 2,000,000 UTF-16 code units
and preserves it verbatim, including empty strings. The host owns format validation
and decides whether a completed edit sets content, deletes a text item or clears a
label. `setTextCommand` stores content as one history entry; `setShapeLabelCommand`
clears a label only when the host omits it. Existing transforms, picking, ordering
and clipboard work unchanged.

Pass `{measureText}` to the editor for actual font metrics. The default browser
measurer and Solid TextView treat content as literal plain text. A host using an
encoded format supplies a `contentView` to TextView/RectangleView/EllipseView and a
matching TextMeasurer. Graphics does not parse editor JSON or infer empty content.

Canvas Next owns its Lexical codec in `canvas-next/core/text-codec.ts`, including
bounded tree validation, seed construction, serialization and empty-content
checks. Its clipboard adapter validates imported text/labels.
It uses the shared Markdown builder and StaticLexical renderer for editing,
display and measurement, and owns the matching markup styles. Only the active item
mounts an editable editor. The optional Loro adapter continues storing the whole
string without parsing it; no content migration is needed.

The shared host supports mentions in both text and labels. Mention decorators
scale with typography; active editing keeps the native caret without an extra
box outline. Backend mention tracking/notifications remain disabled in Canvas Next.

Single-text side edges change wrapping width; other grips scale font and box
proportionally. Completed content is one LWW string in the optional Loro adapter,
independent of pose. This is the chosen collaboration granularity, not a character
CRDT. GraphicsSurface accepts overlays, hidden selection and suspended input so
host editing stays separate from geometric tools.

Mixed selections containing text scale uniformly to preserve letter proportions;
use a single text shape’s side edges to change wrapping width. Shape definitions
express this through the `canDeform` capability used by selection-frame math.

Rectangles, ellipses and connectors accept `geometry.label?: ShapeLabel`, containing
portable rich content, font family/size, and measured height. Box label width is
derived from the padded shape interior. Connector labels store a measured width
and sit at the route midpoint. `setShapeLabelCommand` edits/clears only the label.
`shapeLabelLayout` supplies a shared local transform for rendering, editing, and
picking. Box labels wrap and fit uniformly inside their owner. Shape resizing uses
the injected measurer to update label height; headless hosts without one retain the
stored height and should remeasure before displaying changed wrapping. Labels are
part of shape geometry in the core; fragments preserve their serialized strings.
The Loro adapter stores label content and layout separately from pose, allowing
label creation or editing to merge with moving its owner.
`textTargetAt` is a text-gesture query that includes unfilled shape interiors;
ordinary shape picking adds only the label's visible layout box.

## Connectors and references

`ShapeItem<'connector'>` stores two local endpoints, route (`straight`, `stepped`,
`smooth`), and start/end heads (`none`, `arrow`, `arrow-filled`, `circle`,
`circle-small`). Each endpoint has a fallback `point`, optional outgoing `direction`,
and an optional `{ targetId, anchor }` reference. Anchors are `center`, `top`,
`right`, `bottom`, `left`. References are independent of scene containment;
connectors remain ordinary keyed shape components in document paint order.

`core/connectors.ts` resolves references through the target's current world matrix
and geometry, including uncommitted transform overrides. Side ports stay at edge
midpoints. A center port automatically intersects the target outline toward the
other endpoint (exact ellipse and rounded rectangle outlines; bounds for other
shapes). Groups are not attachment targets; their eligible shape children are.
Connectors cannot target pencil strokes, other connectors or themselves. Missing
or ineligible targets use stored fallback coordinates, so older pencil bindings
still load without following the ink. No route cache or Solid state is persisted
in geometry.

`connector-routing.ts` ports the original Canvas route math: straight segments,
36-unit rectilinear leads with rounded 10-unit corners, cubic smooth curves and the
same arrow/dot styles. Rotated target normals preserve an outward lead. Picking
follows the sampled rendered path and head geometry, with screen tolerance supplied
by the host. It does not select the empty path bounding box.

`createConnectorInteraction` owns a disposable draft and preview scene. The browser
endpoint adapter captures the gesture; `GraphicsSurface.attachControls` owns that
adapter's viewport lifecycle. The app owns tools, defaults, inspector and hover-only
screen-sized endpoint circles. `connectorTargetAt` is the shared hover/start/drop
policy: only the frontmost hovered shape exposes ports; nearby edge points win,
and the interior core activates the center. Only the active port gets a larger
blue halo. Releasing submits `setConnectorCommand` as one history
entry. Escape cancels; Shift snaps free endpoints to 45 degrees. Both endpoints can
be reattached independently. Moving a connector body moves free endpoints while
bound endpoints remain on their targets, matching legacy Canvas.

Copy/paste and duplicate remap references when the targets are copied too. External
references detach at their current visible endpoints. Deleting a target detaches
surviving connectors in the same history transaction; undo restores the references.
Reparenting keeps world positions through the existing tree math. The existing Loro
adapter transports connector geometry and references without core dependencies on
collaboration. Connector labels share the existing label/text path and Loro mapping.
Endpoint drafts are local only; connector-specific remote gesture awareness remains
follow-up work.

### Embedded items

`image` and `video` store box dimensions, a name, and a stable `MediaSource`
(document ID, static-file ID, or safe HTTP(S)/root-relative URL). `document` stores
box dimensions, document ID, file type and a fallback name. Definitions participate
in the same transform, selection, connector, clipboard, grouping and Loro paths as
other shapes. `insertShapesCommand` inserts an ordered batch in one undo step.
Default Solid renderers show placeholders; hosts provide asset and preview views.
No upload, storage-service, player or application preview dependency enters core.

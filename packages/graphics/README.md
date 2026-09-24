# Graphics

Experimental graphics editor with a framework-independent scene tree.

- `@macro-inc/graphics`: document, affine math, scene queries, selection, editing,
  validation and local history. No DOM, Solid, app or Loro imports.
- `@macro-inc/graphics/browser`: pointer capture, keyboard, wheel and local images.
- `@macro-inc/graphics/solid`: read-only reactive projection and keyed renderers.

## Scene contract

Documents have one surface root and a normalized node map. Shapes
and groups have one authoritative `placement: { parentId, sortKey }` and a local
affine `transform: [a,b,c,d,e,f]`. Rectangles own local width/height and appearance.
Groups own no intrinsic geometry; their bounds come from descendants. Child lists
and paint order are derived from case-sensitive fractional string keys allocated
by [fractional-indexing](https://github.com/rocicorp/fractional-indexing).
Use `sortKeysBetween(lower, upper, count)` to create keys; null means an open end.
Keys must be unique among siblings; different parents may reuse keys. Comparison
uses code-unit ordering, never locale-sensitive sorting. Rendering and reverse
hit testing consume the same depth-first scene order.
Flat scenes are ordinary trees with rectangles directly under the surface.

Matrices use column vectors: x'=a*x+c*y+e, y'=b*x+d*y+f. World transforms compose
parent * local. Positive rotation is clockwise; angles are radians. Core queries
own coordinate conversion, inverse transforms, transformed corners, polygon
intersection and topmost hits. Invalid roots, cycles, missing/leaf parents,
nonfinite or noninvertible local/world transforms and invalid dimensions are rejected
before an atomic document commit.

`createScene` accepts only current typed nodes. There are no schema versions,
legacy formats, migrations, or durable persistence adapters in this playground.

Demo data is built by
[`core/test-scenes.ts`](../../apps/web/src/features/graphics-playground/core/test-scenes.ts).
`createGraphicsTestScene()` and `createNestedTestScene()` produce fresh documents
on mount. **Reset test scene** reruns the appropriate seed function, clears
selection/previews/history, selects the selection tool, and resets the camera
(fitting the nested scene). Reloading also recreates the test document. When the
model changes, update these seed scripts and test fixtures directly. No test
documents are read from or written to local storage.

## Editing

The editor composes the selection feature through its explicit `SelectionHost`
contract. Selection, box previews and transform overrides are session state.
Creation, move, rotation, resize, grouping, ungrouping, reparenting and subtree
deletion commit once, with bounded 100-entry local undo/redo. Navigation and
selection never enter history. Invalid operations make no partial changes.

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

Hold Shift during rotation to snap a single shape/group's world angle to 30° increments.
Multiple selections snap the rotation delta while preserving relative angles.
The rotation circle sits 16 screen pixels outside a single shape's oriented top
edge, or above the world-aligned bounds for groups and multiple selections, with
no connecting stem. Single-shape resize adjusts local dimensions and placement while
keeping the opposite corner or edge midpoint fixed. Hold Shift to preserve the
original aspect ratio. Hold Alt/Option to resize from the original center;
Shift+Alt/Option combines both. Modifiers update even without pointer movement.

Invisible targets along each full edge also resize single shapes, multiple selections and groups.
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
during transform previews; individual outlines remain visible. The scene tree does not require
a matching DOM tree.

## Local demos

- `/app/component/graphics-playground`: infinite canvas. Select/Rectangle/Ellipse tools,
  drag-box selection, Shift-click toggle, Shift-drag addition, group move/delete,
  Group/Ungroup and rotation via the circle above the selection. Alt-click targets
  a nested rectangle; ordinary clicks select its outermost group. Single-shape
  selections expose corner handles and invisible full-edge resize targets. Space/middle-drag and wheel pan;
  Ctrl/Meta-wheel zooms; Fit scene leaves space for rotation handles.
  Expand Layers for the scene tree and front/back/forward/backward controls.
- `/app/component/nested-scene-playground`: registry-mounted tester containing a
  rotated, nonuniformly scaled outer group, a rotated inner group and root sibling.
  Expand Layers to inspect hierarchy/select any node directly. Move selected
  to root demonstrates pose-preserving reparenting. Undo restores its parent.
- `/app/component/image-markup-playground`: bundled teo.png and local replacement
  images. Draw annotations, zoom around the image center, fit and clear.
  Panning stays disabled. Annotations are rectangle children of a surface root.
  Image decoding/object URLs stay in the host/browser layer and are disposed on
  replacement/unmount.

Escape/cancellation drops previews. Delete/Backspace and Ctrl/Meta-Z,
Ctrl/Meta-Shift-Z or Ctrl/Meta-Y apply only when the canvas has focus. Data and
history reset on reload. Each mounted demo owns an independent editor.

## Boundaries and verification

One surface per document, static typed rectangle/ellipse/group kinds, linear scene queries,
and local snapshot history are deliberate prototype limits. Frames/clipping,
layout, text, multi-surface documents and runtime plugin loading are not implemented.
Affine reflection/shear compose correctly, but have no dedicated UI controls.
SyncService integration remains separate work. The two-peer Loro experiment uses
native local undo; never apply snapshot undo to a shared document.

The [scene foundation specification](../../docs/GRAPHICS_SCENE_FOUNDATION.md)
describes the intended longer-term boundary and collaboration questions.
Run `bun run test` and `bun run type-check` here. Tests cover tree invariants,
transform math, document reset, pose preservation, nested editing, history, selection,
input routing and stable Solid mounts. The no-DOM compilation/import checks
enforce the pure TypeScript core boundary.

## Adding a shape

Shape registration is explicit and compile-time. There is no mutable global
registry or runtime plugin loading. Rectangle and ellipse follow the same path:

1. Add a pure module under `src/core/shapes/` exporting its geometry type and
   `ShapeDefinition<'kind'>`. Add the geometry type to `ShapeGeometryMap` in
   `model.ts`, then add the definition to the mapped registry in
   `shapes/registry.ts`. TypeScript checks the kind/definition pairing.
2. Implement geometry validation, creation, local bounds, point hit testing,
   box intersection, resize and geometry equality. Bounds currently use a local
   origin of `(0, 0)`; drawing is a two-point bounding-box gesture. `resize`
   returns updated geometry without changing identity/placement/transform;
   the selection feature anchors the opposite corner and applies the transform.
   Geometry is immutable; current payloads are flat value objects.
3. Point picking receives a **local point**, the complete **world transform**,
   and a tolerance in **world units** (`3 / camera.scale`). Measure outline
   distance in world space to preserve screen tolerance through nested affine
   transforms. Marquee intersection uses the actual shape, regardless of fill.
4. Add a Solid component under `src/solid/shapes/` with
   `ShapeViewProps<'kind'>`, and register it in `defaultRenderers` in
   `solid/shape-renderers.tsx`. It receives a reactive item, effective scale and
   optional preview state. Hosts can supply typed overrides via `renderers`;
   image markup retains its rectangle renderer. The core never imports these.
5. The playground toolbar reads registered kinds and labels; shared browser input
   calls `beginShape(kind, point)`, `updateShape`, `commitShape`, `cancelShape`.
   Rectangle aliases remain for the image host. No kind checks belong in the
   selection engine, traversal, browser input or surface renderer.
6. Cover curve/interior picking, zoom tolerance, box intersection, invalid geometry,
   transforms and history, and verify the actual component and controls in-browser.

Ellipse performs analytic curve picking after transforming to principal axes;
marquee queries transform the box into ellipse-normalized coordinates. Neither
uses the ellipse's bounding rectangle as its hit area. Selection handles still
use the local bounding rectangle, as they do for other bounded shapes.

This checkpoint proves typed shape modules, not a general-purpose extension API:
text editing, connectors, layout, custom gesture tools, per-host core registry
composition and dynamic plugins need their own contracts. Schema versioning and
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

`beginTransform` optionally takes an ID factory to preview subtree duplication.
Its session-only preview document includes new nodes; the durable document remains
unchanged until a moved gesture commits. Cancellation discards the preview and
restores the previous selection. Solid keeps original keyed mounts intact.

## Two-peer experiment

`/app/component/graphics-multiplayer-playground` renders Alice and Bob side by side
with independent selection, camera and local undo. Both use real Loro replicas via
`@macro-inc/graphics/loro` and exchange update bytes in memory. Go offline, edit both
sides, then Sync now or Reconnect. Delivery delay and Reset both peers are available.
The ordinary playgrounds continue using memory snapshots; this experiment uses
Loro history exclusively. See [the adapter notes](src/loro/README.md) for its ordered
tree mapping, geometry conflict policy, limitations and validation cases.

The optional `@macro-inc/graphics/loro/solid` wrapper adds colored peer cursors,
selection outlines and ghosts of pending drawing/move/resize/rotation gestures.
Awareness uses a separate ephemeral channel: it never enters the document, local
selection, hit testing or undo. Disconnect clears remote overlays; reconnect sends
fresh presence. The core and ordinary browser/Solid surfaces do not depend on it.

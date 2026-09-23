# Graphics

Experimental graphics editor with a framework-independent scene tree.

- `@macro-inc/graphics`: document, affine math, scene queries, selection, editing,
  versioned decoding and local history. No DOM, Solid, app or Loro imports.
- `@macro-inc/graphics/browser`: pointer capture, keyboard, wheel and local images.
- `@macro-inc/graphics/solid`: read-only reactive projection and keyed renderers.

## Scene contract

Version 2 documents have one surface root and a normalized node map. Rectangles
and groups have one authoritative `placement: { parentId, order }` and a local
affine `transform: [a,b,c,d,e,f]`. Rectangles own local width/height and appearance.
Groups own no intrinsic geometry; their bounds come from descendants. Child lists
and paint order are derived, with ID tie-breaking for equal numeric order keys.
Flat scenes are ordinary trees with rectangles directly under the surface.

Matrices use column vectors: x'=a*x+c*y+e, y'=b*x+d*y+f. World transforms compose
parent * local. Positive rotation is clockwise; angles are radians. Core queries
own coordinate conversion, inverse transforms, transformed corners, polygon
intersection and topmost hits. Invalid roots, cycles, missing/leaf parents,
nonfinite or noninvertible local/world transforms and invalid dimensions are rejected
before an atomic document commit.

`createScene` accepts typed nodes or the original flat rectangle seed format.
`decodeGraphicsDocument(unknown)` validates v2 or migrates v1 position/order into
root placements and translation matrices, returning a structured success/error.
No automatic persistence is enabled.

## Editing

The editor composes the selection feature through its explicit `SelectionHost`
contract. Selection, box previews and transform overrides are session state.
Creation, move, rotation, resize, grouping, ungrouping, reparenting and subtree
deletion commit once, with bounded 100-entry local undo/redo. Navigation and
selection never enter history. Invalid operations make no partial changes.

Group/reparent/ungroup preserve world transforms. Selected ancestors suppress
descendants as edit targets, preventing double movement/deletion. Mixed-parent
moves and pivoted rotation operate in world space, then convert back into each
parent's coordinates. Rectangle resize adjusts local dimensions and placement
while keeping the opposite corner fixed. Shared corner handles scale multiple selections and persistent groups in world
space about the opposite corner, then convert each selected root back into its
parent space. Rotated selections, nested items and groups scale proportionally to avoid shear.
Flat unrotated selections can scale independently per axis. Scale clamps at 1% to avoid collapse
or flipping. Scaling changes transforms, not local rectangle dimensions.

Grouping initially requires a common parent. Noncontiguous siblings become one
contiguous group at their earliest selected sibling position, which can change
stacking relative to unselected siblings. Ungroup splices children back in order.
Reparent also supplies explicit sibling order; the memory backend uses finite
numeric keys. This is not a finalized collaborative ordering representation.

Solid renders drawable IDs in tree paint order with computed world matrices.
Grouping/reparenting preserves keyed component identity. Selection polygons,
a dashed shared selection box, corner handles and rotation handles are drawn in a viewport overlay, so their
size is independent of ancestor scale/rotation. The shared box and handles hide
during transform previews; individual outlines remain visible. The scene tree does not require
a matching DOM tree.

## Local demos

- `/app/component/graphics-playground`: infinite canvas. Select/Rectangle tools,
  drag-box selection, Shift-click toggle, Shift-drag addition, group move/delete,
  Group/Ungroup and rotation via the circle above the selection. Alt-click targets
  a nested rectangle; ordinary clicks select its outermost group. Single rectangle
  selections expose corner resize handles. Space/middle-drag and wheel pan;
  Ctrl/Meta-wheel zooms; Fit scene leaves space for rotation handles.
- `/app/component/nested-scene-playground`: registry-mounted tester containing a
  rotated, nonuniformly scaled outer group, a rotated inner group and root sibling.
  Expand Scene tree to inspect hierarchy/select any node directly. Move selected
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

One surface per document, static typed rectangle/group kinds, linear scene queries,
and local snapshot history are deliberate prototype limits. Frames/clipping,
layout, text, multi-surface documents and plugin registration are not implemented.
Affine reflection/shear compose correctly, but have no dedicated UI controls.
Loro/SyncService integration and origin-aware collaborative undo remain separate
work; never apply snapshot undo to a shared document.

The [scene foundation specification](../../docs/GRAPHICS_SCENE_FOUNDATION.md)
describes the intended longer-term boundary and collaboration questions.
Run `bun run test` and `bun run type-check` here. Tests cover tree invariants,
transform math, migration, pose preservation, nested editing, history, selection,
input routing and stable Solid mounts. The no-DOM compilation/import checks
enforce the pure TypeScript core boundary.

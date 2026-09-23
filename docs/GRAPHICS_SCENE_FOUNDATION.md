# Graphics scene foundation

Status: the local scene foundation and demo adaptation are implemented in
packages/graphics: normalized surface/group/rectangle tree, affine math, validated
structural operations, transformed selection/editing, rotation handle, versioned
decoder/migration and nested-scene tester. Both existing demos use version 2.

The current implementation supports one surface per document, numeric sibling
order keys, linear queries and local snapshot undo. Multi-surface documents,
decomposition inspectors, incremental query caches and the Loro convergence spike
remain future work. The design below records the intended boundary; those future
capabilities must not be inferred from the local prototype.

This checkpoint supersedes the flat-scene scope in the original rectangle plan.

## Document structure

Use a normalized node map with stable IDs and an ordered containment tree. Flat
scenes are trees whose drawable nodes are all immediate children of a surface.
The document owns ordered surfaces; each surface is a coordinate-space root.
Whiteboards are unbounded surfaces; image markup and slides use bounded surfaces.
A surface references image assets through durable IDs, never object URLs.

Each non-root node has exactly one authoritative placement value containing its
parent ID and sibling order key. Derive child lists and parent/ancestor indexes;
do not persist both a parent pointer and independent child arrays. Parent and
order are one structural edit. Order keys require a deterministic ID tie-breaker;
allocation and any rebalance belong to the backend, not UI code. Loro may expose
this contract through its own ordered tree rather than literal placement fields.

Initially support rectangle and group node kinds. Groups establish coordinate
spaces and ordered children, have no intrinsic painted geometry, and do not clip.
Their bounds are derived from descendants. Frames, clipping, layout containers,
connectors, and comments are later node/capability types. Connector and comment
references are graph edges independent of the containment tree. Avoid using one
parent relation for coordinate containment, temporary selection, and arbitrary
semantic associations.

Tree invariants are enforced before atomic commit: IDs are unique, parents exist
and can contain children, roots cannot be reparented, every live node is reachable
from one surface, and cycles/self-parenting/cross-surface containment are rejected.
An explicit transfer command can move content between surfaces later. Deleting a
container deletes its subtree as one transaction. Undo restores identity, content,
placement, and order. Derived indexes are never serialized or restored as history.

## Coordinates and affine transforms

Every spatial node has an authoritative local affine matrix `(a, b, c, d, e, f)`.
With column-vector notation:

```text
x' = a*x + c*y + e
y' = b*x + d*y + f
world(node) = world(parent) * local(node)
screen(node) = camera(surface) * world(node)
```

Rectangle geometry is local `(0, 0, width, height)`. Position is matrix translation,
not a second writable x/y pair. Provide translation/rotation/scale constructors
and readable decomposition helpers, but never store both a matrix and independent
angle/scale/position fields. Supporting general affine composition now avoids
losing shear when nesting rotation and nonuniform scale. It does not require
exposing skew controls in the product.

Define radians, clockwise-positive rotation in screen coordinates, matrix order,
and point versus vector conversion explicitly. Transform pivots are operation
inputs (for example selection center); apply T(pivot) * R * T(-pivot). Do not
silently use changing group bounds as a persistent CSS transform origin. Render
with transform-origin 0 0 and the same matrix convention as core.

Core math includes compose, guarded inverse, point/vector mapping, transformed
corners, enclosing bounds, and polygon intersection. Reject non-finite and singular
transforms; specify an inversion tolerance and permitted scale limits. Reflections
are representable. Keep camera zoom limits separate from document transform limits.

Rectangle resizing changes its local dimensions and placement to preserve the
opposite anchor. Group scaling changes its transform; it is not synonymous with
resizing every child. Text/stroke/layout behavior under scaling remains a product
policy to settle before exposing group scale handles.

## Scene queries and selection

One pure scene-query layer owns traversal, world transforms, local/world geometry,
paint order, subtree bounds, and world-to-local conversion. Begin with linear
queries and disposable derived caches; no spatial-index dependency is needed.
Changes invalidate affected descendants' world transforms and ancestors' aggregate
bounds. Preview queries apply session overrides before deriving descendant geometry.

Point hit testing converts a world point into node-local coordinates before asking
the typed shape definition. Box selection uses actual transformed rectangle
polygons after an AABB broad phase; rotated AABBs alone produce false selections.
Nested reverse paint order determines topmost hits. Visibility, locks and clipping
need explicit query policies as those capabilities are introduced.

Selection contains IDs, never copied geometry. Normalize edit targets to selected
roots: if a parent and its descendant are both selected, transform/delete the
subtree only once. For the first grouping UI, a normal click selects the outermost
group in the current editing scope. Entering a group is a subsequent explicit
interaction, not an accidental consequence of DOM event targets.

For a world-space move D, transform each selected root as:

    newLocal = inverse(parentWorld) * D * oldWorld

This handles selections under different rotated/scaled parents. Rotation uses the
same expression with a pivoted world rotation. Temporary multiselection is not a
persistent group. Keep handles in a viewport overlay so they remain constant-sized
and axis-correct despite rotated, skewed or nonuniformly scaled ancestors.

## Structural operations and editing boundaries

Implement create, transform, resize, reparent, reorder, group, ungroup and subtree
delete as validated atomic operations. Group/reparent preserves appearance via:

    newLocal = inverse(newParentWorld) * oldWorld

Group the selected roots under their common parent initially. Insert the new group
at an explicit sibling position and preserve child order. Grouping noncontiguous
siblings can change stacking relative to unselected siblings: the command must
specify that result rather than claiming every compositing relationship is preserved.
Cross-parent grouping requires an explicit policy; do not guess or silently flatten.
Ungroup splices children into the group's sibling position and preserves world pose.

The editor owns transactions/history, the scene owns structure/coordinate queries,
and the selection feature owns selection/gesture state. Features receive narrow
read/query/commit interfaces. Browser adapters normalize input and manage capture;
they do not own authoritative hit testing. Solid renders read-only node projections.
A scene tree does not require recursive DOM: initially render drawable IDs in tree
paint order with computed world matrices, keeping keyed components mounted across
reparenting. Nested DOM, clipping, and layout renderers can be introduced separately.

Each pointer gesture previews and commits once. Cancellation discards the overlay.
History restores document structure and transforms together; camera and selection
remain local session state. Local snapshot history remains acceptable for this
prototype, but its interface must allow operation-aware collaborative undo later.

## Collaboration and validation boundaries

The logical scene tree is mandatory now; its CRDT encoding is not decided by the
memory representation. Keep structural operations explicit. Validate an ordered
LoroTree mapping against concurrent reparenting, deletion and ordering before
freezing persistence. Local tree validation alone cannot prevent cycles caused by
merging concurrent parent-map edits.

World-pose-preserving reparenting depends on both placement and local transform.
A local transaction does not guarantee those fields win together under CRDT merge.
Require a documented policy and convergence tests for move versus reparent, opposite
reparents, and deleting a group while another peer extracts a child. Do not call the
schema collaboration-ready until these cases have a defined outcome.

Version the document format. Convert the prototype's flat order into root children,
map x/y to translation matrices, and retain width/height as local geometry. Reject
invalid tree references/transforms with structured diagnostics on decode. Keep
TypeScript definitions authoritative; runtime validation consumes unknown data.

## Implementation gates

1. Math and model: affine tests, normalized tree types, validation, flat-scene
   migration and headless scene queries. Demonstrate nested rotation/nonuniform
   scale and round-trip coordinate conversion, including reflections and rejected
   singular transforms.
2. Editing kernel: atomic structural operations and undo. Test reparent/group/
   ungroup world-pose preservation, ordering, descendant deletion/restoration,
   cycle rejection, mixed-parent movement and parent/child selection normalization.
3. Adapt the demos: rectangle rendering, selection, marquee, move and resize all
   consume scene queries. Both the infinite canvas and centered image demo work
   on surface roots. Include a seeded nested rotated group to expose accidental
   world-space assumptions. Verify keyed rendering and zoom-independent handles.
4. Validate the Loro structural mapping in an isolated multi-replica harness before
   persistence or network integration. This can inform the storage adapter without
   making local scene math depend on Loro.

Gates 1–3 are the next implementation checkpoint. No further editing features
should build on the existing flat geometry model.

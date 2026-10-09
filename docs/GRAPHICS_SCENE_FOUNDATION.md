# Graphics scene foundation

The graphics scene is a normalized containment tree with stable IDs. A surface is
the coordinate-space root; groups establish nested coordinate spaces; drawable
items provide typed geometry and appearance.

## Structure and coordinates

- Each non-root item has one authoritative parent and sibling order.
- Every spatial item has one local affine matrix; world transforms are composed
  through ancestors.
- Position, rotation, and scale are views of that matrix, not parallel saved
  fields.
- References such as connector endpoints are graph edges, separate from
  containment.
- Derived child lists, world transforms, bounds, and indexes are never persisted.

Validation rejects missing parents, cycles, unreachable items, invalid geometry,
non-finite transforms, and illegal containment before an atomic commit. Reparent,
group, and ungroup operations preserve world pose. Deleting a container removes
its subtree as one operation.

## Queries and editing

Scene queries own traversal, paint order, coordinate conversion, bounds, and hit
testing. Selection stores IDs and normalizes to selected roots so descendants are
not transformed twice. Handles and guides render in a viewport overlay.

Typed shape definitions own validation, local bounds, hit testing, resizing, and
equality. The editor owns transactions and history; browser adapters normalize
input; Solid renderers consume read-only projections. A gesture previews temporary
overrides and commits once, while cancellation discards the preview.

## Collaboration boundary

The in-memory scene model is independent of its backend. The optional Loro adapter
maps the same logical tree to collaborative storage and uses native local undo.
Production use still requires approved conflict behavior for concurrent reparent,
delete, ordering, and pose edits.

See the [graphics README](../packages/graphics/README.md),
[Loro notes](../packages/graphics/src/loro/README.md), and
[architecture overview](CANVAS_ARCHITECTURE.md).

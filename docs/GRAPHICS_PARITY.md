# Graphics and Canvas parity

Canvas Next implements the shared graphics foundation and the main local editing
flows. It opens supported saved documents behind the Canvas Next rollout, migrates
older JSON at the host boundary, and writes the current versioned format.

## Current coverage

| Area | Status |
| --- | --- |
| Scene and transforms | Tree structure, grouping, ordering, rotation, resize, alignment, and distribution are implemented |
| Everyday editing | Selection, marquee, move, duplicate, clipboard, nudge, undo/redo, and context actions are implemented |
| Content | Shapes, pencil, rich text and labels, connectors, images, video, document cards, and embeds are implemented |
| Presentation | Solid rendering, overlays, fit/pan/zoom, inspectors, and shared controls are implemented |
| Persistence | Versioned JSON loading, migration, and saving are connected at the Canvas host boundary |
| Collaboration | Loro mapping and two-peer tests exist; production transport, recovery, and rollout are not complete |

## Ownership

Graphics owns reusable document structure, geometry, commands, queries, shape
contracts, and optional browser/Solid/Loro adapters. Canvas owns tools, shortcuts,
Lexical, colors and defaults, assets, Macro content, permissions, persistence,
migration, sharing, and product rollout.

## Remaining priorities

1. Finish and validate the bidirectional legacy bridge with explicit diagnostics.
2. Lock down durable artwork colors separately from theme-driven application UI.
3. Integrate production collaboration, offline recovery, and permission handling.
4. Add high-value whiteboard gaps such as snapping, touch, crop, frames, export,
   and libraries as separate checkpoints.
5. Measure mixed-content scenes before adding broad indexing or culling systems.

Do not block production integration on every optional parity feature, and do not
copy the legacy or Excalidraw data model into the new transform tree. Each new
renderer must preserve shared paint order, reverse hit order, and stable mounted
identity.

See the [Canvas architecture](CANVAS_ARCHITECTURE.md),
[legacy bridge](CANVAS_LEGACY_BRIDGE.md),
[graphics README](../packages/graphics/README.md), and
[Canvas Next README](../apps/web/src/features/block-canvas/canvas-next/README.md).

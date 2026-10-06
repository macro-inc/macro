# Canvas architecture

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
| Loro adapter | Optional CRDT mapping, collaborative undo, and ephemeral presence |

## State boundaries

- The document stores stable IDs, ordered containment, local transforms, typed
  shape data, appearance, and durable references.
- The editor session stores selection, active tool, gesture previews, and history.
- The view stores camera, hover, focus, and other local-only state.
- Gestures preview transient state and commit one validated command when complete.

Graphics treats rich text as opaque content and assets as stable references. It
must not depend on Macro services, Lexical, the DOM, Solid, object URLs, or theme
variables. Canvas adapters resolve those concerns at the edge.

Saved Canvas Next documents use a versioned JSON boundary. The Loro backend and
two-peer harness prove the collaboration mapping, but production SyncService
integration and conflict-policy approval remain separate work.

## Principles

- Keep one authoritative representation for structure and transforms.
- Preserve world pose when moving items through the scene tree.
- Validate commands atomically and keep derived indexes out of saved data.
- Add capabilities through typed definitions and explicit adapters.
- Keep application migration and compatibility logic outside graphics core.

See the [graphics package README](../packages/graphics/README.md),
[scene foundation](GRAPHICS_SCENE_FOUNDATION.md),
[Canvas Next README](../apps/web/src/features/block-canvas/canvas-next/README.md),
and [collaboration notes](../packages/graphics/src/loro/README.md).

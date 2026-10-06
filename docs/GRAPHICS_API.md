# Graphics API

Current implementation reference, checked 2026-10-05. This guide describes the
exported API in `packages/graphics`; implementation takes precedence over older
design and parity plans.

## Entry points

| Import | Responsibility |
| --- | --- |
| `@macro-inc/graphics` | Pure TypeScript document model, geometry, commands, editor, selection and history. No DOM, Solid, Macro services or Loro dependency. |
| `@macro-inc/graphics/browser` | `attachCameraControls`: pointer, wheel and keyboard input; returns a cleanup function. |
| `@macro-inc/graphics/solid` | `GraphicsSurface`, `createGraphicsProjection`, default renderers and typed renderer overrides. |
| `@macro-inc/graphics/loro` | Optional `createLoroSeed`, `createLoroGraphicsBackend` and presence APIs. The in-memory peer transport is test-only. |
| `@macro-inc/graphics/loro/solid` | `CollaborativeGraphicsSurface` and `GraphicsPresenceOverlay`. |

## Model and ownership

`GraphicsDocument` contains `rootId`, an immutable `items` map, and an optional
bounded image `surface`. The root is a surface node. Shapes and groups have an
`id`, `placement: { parentId, sortKey }`, and a local affine `transform`.
World transforms compose parent × local; sibling sort keys determine paint order.
Groups derive their bounds from descendants.

`ShapeItem<K>` pairs a kind with typed `geometry` and `appearance`. Current kinds
are rectangle, ellipse, pencil, text, connector, image, video and document.
Rectangles, ellipses and connectors can own rich-text labels. Text content is an
opaque string: the host supplies its codec, editor, renderer and `TextMeasurer`.

The editor owns camera and temporary editing state separately from the document.
Selection, gesture previews and camera changes are not saved scene edits.
`freezeDocument` validates scene structure and geometry before commits.

## Create and edit

```ts
import {
  createGraphicsEditor,
  insertShapesCommand,
  nudgeCommand,
} from '@macro-inc/graphics';

const editor = createGraphicsEditor([], { snapUnit: 1 });
editor.execute(insertShapesCommand, [{
  item: {
    id: 'box',
    type: 'rectangle',
    geometry: { width: 160, height: 100 },
    appearance: { fill: '#ffffff', stroke: '#222222', strokeWidth: 2 },
  },
  point: { x: 40, y: 40 },
}]);
editor.select('box');
editor.execute(nudgeCommand, { x: 10, y: 0 });
editor.undo();
editor.dispose(); // The host owns editor lifetime.
```

- **Read:** `editor.document`, `getSession()`, `getCamera()`; subscribe with
  `subscribeDocument`, `subscribeSession`, `subscribeCamera` and `subscribePreview`.
  Each subscription returns an unsubscribe function.
- **Edit:** `execute(command, payload)` runs a typed `GraphicsCommand<Payload>`.
  Its pure `apply` receives document, selection, snap interval and text measurer;
  it returns a document and optional selection. Changed documents enter history;
  previews are cancelled before execution. Built-ins cover insertion, styles,
  nudge, duplication, paste, alignment, distribution, text and connector edits.
- **Interact:** drawing uses `beginShape` / `updateDrawing` / `commitShape` /
  `cancelShape`; transforms use the corresponding `beginTransform` /
  `updateTransform` / `commitTransform` / `cancelTransform` methods. Keep drafts
  temporary and commit the completed gesture once.
- **Query:** `worldMatrix`, `worldBounds`, `paintOrder`, `hitTest` and
  `selectionFrame` provide shared scene calculations. Use shape resize operations
  and the injected measurer when resizing geometry; scaling a transform alone can
  stretch text and labels.

## Render and extend

Mount `<GraphicsSurface editor={editor} />` inside a sized Solid host. It attaches
browser controls and renders the scene with keyed mounts. Supply `renderers` for
typed shape-view overrides and `input` for tool/input policy.
`createGraphicsProjection(editor)` exposes reactive document, immutable snapshot,
camera, session and preview reads; create it under a Solid owner for cleanup.

Add commands by implementing `GraphicsCommand<Payload>`; no central command
registration is required. Adding a shape kind is a compile-time change: extend
`ShapeGeometryMap`, implement `ShapeDefinition<K>`, register it in
`shapeDefinitions`, and add its Solid renderer and selection outline. Definitions
own validation, freezing, bounds, picking, intersection, resize and equality.
Add acquisition gestures and Loro mapping when the new kind needs them. There is
no runtime shape-plugin registration.

## Backends and host boundary

`createGraphicsEditor(seed, options)` supplies local in-memory history.
`createGraphicsEditorFromBackend(backend, options)` delegates document/history
ownership to `GraphicsBackend`: `getDocument`, `getHistory`, `commit`, `undo`,
`redo` and `subscribe`. Disposing the editor detaches it; the caller still owns
backend disposal. The optional Loro adapter supplies CRDT history and update
exchange; transport and durable storage remain host responsibilities.

Canvas Next owns toolbars, inspectors, Lexical/mentions, permissions, uploads,
imports, file versioning and persistence. Its version 2 JSON save path is
implemented; production SyncService collaboration is not wired. These are Canvas
capabilities, not services provided by the graphics core.

Source contracts: [exports](../packages/graphics/src/core/index.ts),
[editor](../packages/graphics/src/core/editor.ts),
[model](../packages/graphics/src/core/model.ts),
[commands](../packages/graphics/src/core/commands.ts),
[shape definitions](../packages/graphics/src/core/shapes/definition.ts),
[Canvas host](../apps/web/src/features/block-canvas/canvas-next/README.md).

# Graphics API

`@macro-inc/graphics` provides the reusable scene, editing, input, rendering, and
optional collaboration layers used by Canvas Next.

## Entry points

| Import | Purpose |
| --- | --- |
| `@macro-inc/graphics` | Document model, editor, commands, geometry, queries, and shape definitions |
| `@macro-inc/graphics/browser` | Browser input, clipboard, and gesture adapters |
| `@macro-inc/graphics/solid` | Solid renderers and scene projections |
| `@macro-inc/graphics/loro` | Optional collaborative document and presence backend |

The document is an immutable, normalized tree with stable IDs, sibling order,
local affine transforms, typed item data, and durable references. The editor owns
validated commits, selection, gesture state, and local history. Cameras and other
view state remain outside the document.

Create documents through the public constructors, pass commands through the
editor, and read geometry through scene queries. Browser gestures may preview
changes, but should produce one final command. Renderers consume read-only
projections and must not become a second source of truth.

## Extending graphics

New shape kinds provide typed data, runtime validation, bounds, hit testing,
resize behavior, equality, and rendering. Add browser gestures or collaboration
mapping only when the feature needs them. Keep feature registration explicit and
centrally compiled.

Host applications provide text measurement and editing, asset resolution,
navigation, permissions, storage, and service integration. Graphics stores opaque
text and stable asset/entity references; it does not import application services.

See the [package README](../packages/graphics/README.md),
[scene foundation](GRAPHICS_SCENE_FOUNDATION.md), and
[Canvas architecture](CANVAS_ARCHITECTURE.md).

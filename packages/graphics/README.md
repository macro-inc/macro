# Graphics

Experimental graphics editor: camera navigation and local image rectangle markup.

- `@macro-inc/graphics`: pure TypeScript model, rectangle definition and editor.
- `@macro-inc/graphics/browser`: disposable pointer/wheel camera bindings.
- `@macro-inc/graphics/solid`: owner-scoped projection and Solid surface/renderers.

The host creates an editor and disposes it on unmount. Each instance owns its
document and camera. Document snapshots are immutable; edits and camera changes
are published synchronously. Core uses world units for geometry and viewport
pixels for camera translation. Zoom preserves the world point beneath its anchor.

Create item data with `type: 'rectangle'`, `id`, `geometry` and `appearance`.
The separate `rectangleDefinition` supplies pure geometry/hit testing.
`ItemRenderers` maps each item kind to a Solid component receiving exactly that
item type and current camera scale. The surface owns placement; components paint their content. Adding a
kind requires extending the item union, providing its pure definition, and adding
its typed renderer and dispatch. No global plugin registry or framework-bound
record instances are involved.

The root export cannot import browser or Solid modules. `bun run type-check`
includes a no-DOM core compilation, and tests guard the core import boundary.
Run `bun run test` from this package for camera, ownership, input and rendering tests.

Open `/app/component/graphics-playground` on the local web dev server. It is
registered under `LOCAL_ONLY`. Scroll to pan, use middle-button or Space-drag to
pan, and Ctrl/Meta-scroll to zoom at the pointer. Toolbar zoom uses viewport center;
Reset view restores the initial camera. Focus the canvas before keyboard controls.

Open `/app/component/image-markup-playground` for the image variant. The bundled
`teo.png` loads automatically. Draw rectangles and scroll or use the buttons to zoom.
This host uses `centered-image` navigation: panning is disabled, and zoom and viewport
resize keep the image centered. Fit image fits it in the current viewport. Escape, pointer cancellation and focus
loss cancel an in-progress rectangle. Starts outside the image are ignored and
endpoints are constrained to image bounds. Clicks/tiny drags create no annotation.
Replace image starts a fresh scene; invalid files preserve the previous scene.
Clear rectangles removes all annotations. This prototype does not save or upload.

The core stores image identity and dimensions, and commits rectangles in image
pixel coordinates. Object URLs and decoding stay in the browser layer; the host
disposes loaded image resources on replacement/unmount. Gesture previews are
separate from the committed document. The Solid projection updates its store from
document notifications, preserving stable ID-based rendering. The image host uses
a rectangle renderer with a constant screen-width outline.

Selection, resizing, history, persistence and collaboration follow in later
checkpoints. The flat document representation is not a finalized sync schema.

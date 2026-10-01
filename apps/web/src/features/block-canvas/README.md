# block-canvas

Saved documents can opt into [Canvas Next](canvas-next/README.md) with the
`enable-canvas-next` flag. The frontend migrates legacy JSON on load and writes
version 2 through the existing storage endpoint after editing. Unsupported legacy
content stays available in the legacy editor; newer versions are never handed to
it. SyncService integration is deferred.


This block is a canvas where you can create, export, and import diagrams.

The rewrite lives in [canvas-next](canvas-next/README.md) and uses the pure TS
graphics package. Its local-only demo remains available at
`/app/component/canvas-next` under `USE_CANVAS_NEXT`.

The editor has drawing, rich text/mentions, connectors, media and document
cards/embeds. Embedded documents keep their existing persistence. See the
[parity plan](../../../../../docs/GRAPHICS_PARITY.md) for remaining collaboration,
legacy-content support and editing work.

# Canvas legacy bridge

The legacy bridge converts between legacy Canvas records and the Canvas Next
document model. It belongs to the Canvas application layer, not
`@macro-inc/graphics`, because it understands old schemas, Lexical payloads,
Macro entities, and product rollout policy.

## Contract

- Import legacy JSON through a versioned, validated boundary.
- Preserve stable IDs, effective paint order, geometry, bindings, text, media,
  and unknown source data whenever possible.
- Return explicit diagnostics for unsupported or lossy conversions.
- Never silently overwrite a legacy document that cannot round-trip safely.
- Keep the original payload available until compatibility is established.

The first supported slice should cover common shapes, groups, free connectors,
bound connectors, text, images, videos, and Macro document references. Rich-text
details, unusual transforms, unknown node kinds, and legacy-only behaviors require
fixtures and an explicit fallback policy.

## Color policy

Saved artwork colors are durable literal values. Theme tokens belong to Canvas UI
chrome and must be resolved before crossing the document boundary. Import should
preserve legacy color and alpha values exactly; export must report values the old
format cannot represent.

## Rollout

Build the bridge behind the existing Canvas Next rollout boundary. Compare both
renderers on representative fixtures, make diagnostics visible to the host, and
only enable write-back for documents whose supported subset round-trips without
silent loss.

See the [architecture overview](CANVAS_ARCHITECTURE.md),
[parity plan](GRAPHICS_PARITY.md), and
[Canvas Next format notes](../apps/web/src/features/block-canvas/canvas-next/README.md).

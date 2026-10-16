# Canvas legacy bridge

The legacy migration imports version 1 Canvas records into the Canvas Next
version 2 document model. The old editor and downgrade path are not available. It belongs to the Canvas application layer, not
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
bound connectors, text, images, videos, and Macro entity references. Rich-text
details, unusual transforms, unknown node kinds, and legacy-only behaviors require
fixtures and an explicit fallback policy.

## Color policy

Saved artwork colors are durable literal values. Theme tokens belong to Canvas UI
chrome and must be resolved before crossing the document boundary. Import should
preserve legacy color and alpha values exactly; export must report values the old
format cannot represent.

## Loading and saving

Canvas Next opens all saved canvases without a rollout flag. Supported legacy
files migrate in memory and retain their original JSON in migration metadata.
The first committed edit saves version 2; opening a file alone does not save it.
Unsupported records and unknown versions show an error without changing the
saved document. Validate any expanded import support against representative
fixtures before allowing write-back.

See the [architecture overview](canvas.md),
[parity plan](../design/graphics-parity.md), and
[Canvas Next format notes](../../apps/web/src/features/block-canvas/README.md).

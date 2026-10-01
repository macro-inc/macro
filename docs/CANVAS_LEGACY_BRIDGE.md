# Canvas legacy bridge and color decisions

Priority updated 2026-09-28: old → new → old conversion comes before a full
Canvas Next multiplayer composition. This is the next checkpoint specification,
not an implemented converter. Production peer/sync expansion is deferred.

## Bridge boundary

Put the adapter beside Canvas Next under `block-canvas`, importing the old wire
format and the new graphics model. Keep old-format rules, Markdown conversion,
Macro references and color resolution out of the pure graphics package. TypeScript
continues to own new types; the existing Zod decoder may remain at the legacy input
boundary. Decode a copy: the legacy entity-mention preprocessor mutates its input.

Provide separate import/export functions returning data plus per-item diagnostics.
Preserve IDs and references, and keep original legacy records/metadata in a
host-owned bridge envelope for unchanged-field round trips. Do not add legacy-only
fields to every core shape. The envelope must be updated alongside an editor
session; unknown data must never disappear through decode or save.

The integration target still needs confirmation: opening/saving the existing JSON
through Canvas Next, or an explicit import/export flow. These have different
compatibility requirements. In either case a conversion with unrepresentable edits
must report them; it must not silently replace rotation with a bounding rectangle,
drop unsupported nodes, or flatten rich text on an ordinary save.

## Mapping audit

| Concern | Old → new | New → old / compatibility limit |
| --- | --- | --- |
| Shapes/pose | `shape` rectangle/ellipse, x/y and dimensions → typed geometry plus local matrix | Axis-aligned pose can be represented; arbitrary rotation/shear cannot |
| Groups | Flat membership uses both `groupId` and group child lists; reconcile conflicts explicitly, then build a tree without changing world pose | Legacy groups have no transform or nested-group membership; flattening requires an explicit lossy-export policy |
| Ordering | Reproduce effective legacy paint order before allocating stable sibling keys | Legacy layer/order and connected-arrow ordering differ from explicit tree paint order; test overlap fixtures in both renderers |
| Connectors | Separate edges → connector items; side references, routes and numeric head styles map to typed endpoints | Legacy endpoints require a side; dynamic center binding has no direct encoding. Arbitrary new stacking may be overridden by the old renderer |
| Text | Markdown → stringified Lexical through the shared editor's registered nodes/converters | Lexical → Markdown is not lossless for every formatting/decorator feature; unchanged imported Markdown should survive verbatim |
| Shape labels | Plain string → rich label with legacy sizing/alignment defaults | Rich labels cannot be stored losslessly in a plain label string |
| Pencil | `coords`, wScale/hScale and world placement → local samples/pose | Legacy draws quadratic centerline strokes with non-scaling width; new pencil generates pressure-shaped ink. Sample conversion alone does not preserve appearance or pressure |
| Images/video | DSS/static IDs and flip flags → stable media source and reflected pose | URL sources, loading items and unsupported transforms need explicit handling; never save transient URLs |
| Entity cards | Legacy document references can use document items; file type/name may need injected lookup | Other legacy entity types, subpaths and mention IDs need preservation. New full-embed mode has no equivalent legacy field |
| Links/unknown data | Validate and retain source records; identify unsupported content | Do not silently skip types the new registry cannot render/edit |
| Colors/styles | Preserve stored literals and omitted/default distinctions | CSS-variable paints cannot be written directly to the old hex/transparent fields |

Legacy paint order is not just sorting the stored fields. `renderQueue.ts` derives
group members' order from their group and connected edges' order/layer from their
targets. The new tree requires contiguous subtrees. Some legacy group/edge stacking
may therefore be incompatible with retaining both membership and visual order.

Legacy shape rendering also applies 80% fill alpha, and default colors/stroke
rules vary by renderer. Capture these behaviors in fixtures rather than assuming
the two style objects have identical semantics. The `importedColor` field exists,
but the inspected shape/line/pencil renderers do not use it to resolve a palette.

## Proposed first implementation slice

1. Add a pure conversion result/diagnostics contract and deterministic fixtures for
   rectangles/ellipses, groups/order, free/side-bound connectors and stable media.
   Support exact common-subset conversion in both directions; identify unsupported
   records/edits without destructive fallback.
2. Extend the application text codec with legacy Markdown conversion using the
   shared Markdown builder/node vocabulary. Lexical validation, seed construction,
   serialization and empty-content decisions now live in Canvas Next
   `core/text-codec.ts`; graphics keeps opaque strings, geometry and injected
   measurement. Whole-string LWW is unchanged. Test legacy conversion of mentions,
   labels, formatting and unchanged original strings. Decide how to retain richer
   new content before enabling legacy-format saves for it.
3. Add a local comparison harness: legacy render, converted Canvas Next render,
   and legacy render of the reverse conversion. Check overlap, endpoints, text,
   styles and pencil appearance, not only serialized equality.
4. Wire the chosen open/save or import/export flow only after the compatibility
   policy is settled. Existing durable JSON can remain the storage path if chosen;
   Loro/SyncService migration is not a prerequisite for this bridge.

An old-reader-compatible extension is another option for new-only data, but it
needs an explicit preservation contract in the old load/edit/save path. Adding
unknown JSON fields alone does not prove that editing with the old app retains
them or that newer pose/text metadata remains consistent with old edits.

## Colors: decision needed

Current legacy documents store hex/transparent strings. Canvas Next's palette
instead stores `var(--color-ink)`, `var(--color-accent)`, panel colors and similar
app tokens. Those resolve from each viewer's app theme and cannot independently
describe a drawing's color or round-trip into the legacy schema.

Recommendation for the first bridge: retain imported literal colors exactly;
use explicit literal artwork colors (including alpha) and a separate no-paint
choice. UI chrome can continue using app theme tokens. A document-owned canvas
background makes artwork/export predictable, but its storage in the old format
must be decided because the current top-level schema has no background field.
Until that decision, do not invent a persistent background extension.

Alternative: a canvas-specific adaptive palette with stable palette IDs and a
defined light/dark resolution policy, plus literal custom/imported colors. Palette
IDs must be independent of the user's personal app accent. Legacy/export adapters
need a defined concrete color projection and preservation metadata for reverse
conversion; resolving CSS variables at save time is not a reversible policy.

Neither color model is implemented by this plan. Agree fixed versus adaptive
artwork first; then choose palette/custom picker and alpha behavior. Keep shape
opacity separate from paint alpha, avoid double-applying legacy fill opacity, and
never turn a literal imported hex into a semantic token based on value matching.

## Source references

- [Legacy schema](../apps/web/src/features/block-canvas/model/CanvasModel.ts)
- [Legacy ordering](../apps/web/src/features/block-canvas/util/renderQueue.ts)
- [Legacy text](../apps/web/src/features/block-canvas/component/nodes/TextBox.tsx),
  [shape/label rendering](../apps/web/src/features/block-canvas/component/nodes/Shape.tsx),
  [pencil rendering](../apps/web/src/features/block-canvas/component/nodes/Pencil.tsx)
- [New model](../packages/graphics/src/core/model.ts),
  [current palette](../apps/web/src/features/block-canvas/canvas-next/components/style-inspector.tsx)

# Property

Composable property component library for Macro.

Mirrors `src/features/entity`: small extractors (`Property.Icon`, `Property.Text`,
`Property.Chips`, ...) compose under a `Property.Root` to render property values
in any layout, replacing the duplicated `PropertyValue` / `CondensedPropertyValue`
/ `InlinePropertyValue` / `ListPropertyValue` trees.

Debug page: `/props-debug` (LOCAL_ONLY).

## Side-panel collections

`side-panel/properties/EntityCollectionProperty.tsx` renders non-user, multi-entity
properties. Its body accepts app-item drops in both empty and populated states,
using the same entity-type conversion as the picker. Drops append a reference,
ignore duplicates and the owning entity, and retain existing values. Read-only,
metadata, loading, saving, and open-editor states reject drops. Native file uploads
are not supported here; the Add action remains available for keyboard and touch.

`CollectionEmptyState` remains presentation-only. Property-specific drop handling
and save callbacks belong to the surrounding collection, not the shared UI component.

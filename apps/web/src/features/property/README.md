# Property

Composable property component library for Macro.

Mirrors `src/features/entity`: small extractors (`Property.Icon`, `Property.Text`,
`Property.Chips`, ...) compose under a `Property.Root` to render property values
in any layout, replacing the duplicated `PropertyValue` / `CondensedPropertyValue`
/ `InlinePropertyValue` / `ListPropertyValue` trees.

Debug page: `/props-debug` (LOCAL_ONLY).

## Side-panel collections

`side-panel/properties/EntityCollectionProperty.tsx` renders non-user, multi-entity
properties. Empty collections use a compact message and trailing Add action.
During app-item drags, compatible collections expand into dropzones; incompatible
or unavailable collections show a muted rejection hint. The same target covers
empty and populated bodies, and geometry updates during expansion. Drops append
a reference using the same entity-type conversion as the picker,
ignore duplicate references and the owning entity's type-and-ID pair, and retain
existing values. Picker saves, drops, chip removal, and row removal share a pending
state until refresh completes. Read-only, metadata, loading, saving, and open-editor
states reject drops. Native file uploads are not supported here; the Add action
remains available for keyboard and touch.

`CollectionEmptyState` remains presentation-only. Property-specific drop handling
and save callbacks belong to the surrounding collection, not the shared UI component.

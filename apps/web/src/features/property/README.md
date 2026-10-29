# Property

Composable property component library for Macro.

Mirrors `src/features/entity`: small extractors (`Property.Icon`, `Property.Text`,
`Property.Chips`, ...) compose under a `Property.Root` to render property values
in any layout, replacing the duplicated `PropertyValue` / `CondensedPropertyValue`
/ `InlinePropertyValue` / `ListPropertyValue` trees.

Debug page: `/props-debug` (LOCAL_ONLY).

## Side-panel collections

Property rows use a 4px vertical gap, including inline Tags and the boundary
between regular fields and collection fields.

`side-panel/properties/EntityCollectionProperty.tsx` renders non-user, multi-entity
properties. Empty collections show plain, full-width copy without a resting
border or padded box. The ghost Add action stays beside the property name for
both empty and populated collections. During app-item drags, compatible
collections expand into full-width dashed dropzones with the same
label-to-content gap.
Incompatible collections keep their Add actions visible and retain their height.
Incompatible or unavailable collections show no rejection feedback. The same
target covers empty and populated bodies, and geometry updates during expansion.
Drops append a reference using the same entity-type conversion as the picker,
ignore duplicate references and the owning entity's type-and-ID pair, and retain
existing values. Picker saves, drops, chip removal, and row removal share a pending
state until refresh completes. While adding references, the dropzone remains
visible with a spinner and “Adding item…” until saving and refresh finish;
existing values remain visible. Collection rows retain their definition identity
through query updates so loading state survives refreshed property objects.
Read-only, metadata, loading, saving, and open-editor states reject drops.
Add and value edits stay disabled until the initial collection finishes loading.
The accessible loading-status region stays mounted outside the collapsing drop
feedback. Native file uploads are not supported here; the Add action remains
available for keyboard and touch.

`component/CollectionEmptyState.tsx` is local to this feature and shared by
property collections and Tags. Drop handling and save callbacks stay in callers.

The dedicated Tags section uses the same plain, full-width empty-state message
and outline Add action below it. The existing tag picker handles the action,
and read-only sections omit it.

## Side-panel header actions

Pass `renderSection` from `SidePanel.Section` to `EntityPropertiesSection` to
compose its icon-only Add property action directly in the header. The existing
property provider owns the header action and picker; no action portal is used.
Read-only sections and `showAddProperty={false}` omit the action.

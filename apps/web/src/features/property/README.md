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
Keep 16px between the property list and the bottom Add property action.

`side-panel/properties/EntityCollectionProperty.tsx` renders non-user, multi-entity
properties. Empty collections show only the property header, with no placeholder
or reserved content area. A labeled ghost Add button aligns with the shared
value-selector column for both empty and populated collections. During compatible
app-item drags, the property name uses accent ink and a small downward arrow
while the row stays compact. Hovering anywhere on that property reveals its
full-width dashed dropzone over 300ms; reduced motion disables the transition.
Other properties do not expand. This first pass uses direct hover, not pointer proximity.
Incompatible collections keep their Add actions visible and retain their height.
Incompatible or unavailable collections show no rejection feedback. One target
covers the name, values, and expanded dropzone, with bounds refreshed as it resizes.
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

Collection drop handling and save callbacks stay in the property callers.

The dedicated Tags section uses a plain muted “No tags added yet” message
and a small ghost Add tags action, without a card, title, or description.
The existing tag picker handles the action; read-only sections omit it.
Inline Tags property rows retain their compact treatment.

## Side-panel header actions

Pass `renderSection` from `SidePanel.Section` to `EntityPropertiesSection` to
compose its icon-only Add property action directly in the header. The existing
property provider owns the header action and picker; no action portal is used.
Read-only sections and `showAddProperty={false}` omit the action.

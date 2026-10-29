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
Keep 16px between populated property lists and the bottom Add property action,
with spacing on the list so empty lists leave no gap above the action.
Keep property names on one line. Collection headers use available space up to
their actions, truncating only the remaining overflow; value rows retain the
shared label column.

`side-panel/properties/EntityCollectionProperty.tsx` renders non-user, multi-entity
properties. Empty collections show only the property header, with no placeholder
or reserved content area. Their labeled ghost Add button aligns with the shared
value-selector column unless a longer name needs more room. Populated collections use an icon-only ghost Add button
at the right, immediately before the pin action. Both use extra-muted ink until
hovered or keyboard-focused. During compatible app-item drags, the property name
uses accent ink and a tray-arrow drop icon while the row stays compact.
Hovering a populated property highlights its existing item list as the dropzone,
without adding a separate box or shifting items. Empty properties reveal a
full-width dashed dropzone. Both use 300ms transitions with reduced-motion support.
This first pass uses direct hover, not pointer proximity. During app-item drags,
collection Add buttons are hidden with their layout space preserved. Incompatible
or unavailable collections show no rejection feedback. One target covers the
name, values, and dropzone, with bounds refreshed as it resizes.
Drops append a reference using the same entity-type conversion as the picker,
ignore duplicate references and the owning entity's type-and-ID pair, and retain
existing values. Picker saves, drops, chip removal, and row removal share a pending
state until refresh completes. New references appear immediately as pending
chips with an inline spinner until saving and refresh finish. Removed references
disappear immediately; a failed save restores them from the last confirmed values.
Confirmed edits remain visible if refresh fails, and reconcile when the query
reflects them. Subsequent edits use these confirmed values rather than stale query
data. Other values remain visible. Failed saves clear pending additions through
the existing error flow. Pending chips cannot be opened or removed. Collection rows
retain their definition identity through query updates so loading state survives
refreshed property objects. Dropped items use the drag label while preview metadata loads.
Read-only, metadata, loading, saving, and open-editor states reject drops.
Add and value edits stay disabled until the initial collection finishes loading.
The accessible loading-status region stays mounted outside the collapsing drop
feedback. Native file uploads are not supported here; the Add action remains
available for keyboard and touch.
Saved-item remove controls overlay the chip's right edge on hover or keyboard
focus and remain visible on touch. They reserve no layout space or change chip
width. Chip backgrounds use `bg-surface` at `Layer depth={3}`.

Collection drop handling and save callbacks stay in the property callers.

The empty dedicated Tags section shows one compact, tag-icon Add tags outline button,
without a separate message, card, title, or description. The existing tag picker
handles the action; read-only sections show “No tags added yet” instead.
Inline Tags property rows retain their compact treatment.

## Side-panel row actions

Compose `PropertyRowActions.Root`, `.Pin`, and `.Remove` through children so
callers own action order. Multi-value layouts and collections accept JSX children,
not action render callbacks. Each collection row owns one saving signal shared
with its collection editor and row actions.

## Side-panel header actions

Pass `renderSection` from `SidePanel.Section` to `EntityPropertiesSection` to
compose its icon-only Add property action directly in the header. The existing
property provider owns the header action and picker; no action portal is used.
Read-only sections and `showAddProperty={false}` omit the action.

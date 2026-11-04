# Property

Composable property component library for Macro.

Mirrors `src/features/entity`: small extractors (`Property.Icon`, `Property.Text`,
`Property.Chips`, ...) compose under a `Property.Root` to render property values
in any layout, replacing the duplicated `PropertyValue` / `CondensedPropertyValue`
/ `InlinePropertyValue` / `ListPropertyValue` trees.

Debug page: `/props-debug` (LOCAL_ONLY).

`Property.Root` shows a pick from the moment an editor saves it until the save
settles and the source emits a newer property, and drops it if the save fails.
The entity editor also passes the names its picker showed, and `Property.Text`
and `ProjectLinkPill` show them while the picked entity's own read loads, so a
pick never reads "Loading…". This holds only while the Root stays mounted: key rows by
definition ID, not property ID or object identity, so a property's first save
(which assigns its ID) and later emissions keep the same Root. Pass its
children as a function (`{(property) => ...}`) and render from that
property, not the prop you passed in. Save handlers keep their own caches
current, so `Property.Root` editors never refetch properties after a save;
side-panel collections own their refresh (below).

`extractors/PropertyEmpty.tsx` shares empty-value glyphs across task list rows,
board cards, group and column headers, and pickers: the wide ascending priority
bars at 30% opacity for no priority, a corner-dashed cube for no project, a
filled person in a dashed circular frame for no assignees, and `calendar-slash`
for no due date. No priority uses the same color and display box as Low/Medium/High,
without additional icon dimming.
In task and project lists, request `PropertyEmptyIcon.muted` for 50%-opacity
empty glyphs; intrinsically muted No priority artwork is not dimmed again.
`Property.Empty` uses the same treatment and 50%-opacity labels. Populated values
stay at full opacity.
Other empty properties retain the dashed circle. Populated project properties
use the regular cube icon through `Property.Icon`. Keep these state indicators
static and readable in compact rows. When composing a project icon separately,
pass `hideIcon` to `Property.Text` to avoid duplicate glyphs.
Status, Priority, and Date icons share a 12px default. List date icons use the
existing 16px compact-column override instead of stretching to the cell width.
Status and Priority selector dropdowns use 16px icons on desktop and touch,
including empty-value options.
Inline task and document title pills use 12px non-avatar icons on desktop and
16px on touch; assignee avatars retain their own sizing. Task title pills omit
the `Due date:` prefix and order Due date before Project and Assignees.
Side-panel Status/Priority values use explicit 16px icons. Side-panel Project
icons, including empty values, use 16px on touch and retain their desktop sizes.
Other callers can override the size.
`Property.UserStack` overlaps assignee avatars and their overflow count by 8px;
other avatar groups retain their shared spacing.
Editable list cells use the shared ghost `Property.Pill` styling. Project hover
cards use a cube header with the assigned value below it; empty Project hover
cards retain the one-line empty message.

`EntityRowTags.collapse` connects to the host's shared priority-overflow controller.
Show at most three individual chips by default and keep the rest in overflow.
Measure actual title, tag, and control widths; collapse more trailing chips when
their combined content overflows, then truncate the title as a last resort.
Keep a sole tag as its named chip, even when the host requests fully collapsed
tags. For multiple tags, label the overflow chip “N tags” when every tag is
collapsed; use “+N tags” only when individual tag chips remain visible.
Hidden tags keep the existing overflow picker and hover actions. Keep the visible
chip count stable while a picker or its nested editor is active so resizing
cannot discard the editing session. A live sorted insertion keeps the active
chip visible within that count, then restores normal order on close. Key visible
chips by option ID so refreshed tag objects do not remount a picker or leave
collapse paused. Release active-picker state when a live update deletes its chip
or overflow trigger. While the tag picker is open, reconcile remote selections
and deleted options without resetting staged additions or removals. Preserve
staged intent through deletion rollbacks; exclude missing options when saving.
When editing ends, immediately re-evaluate new tags against the title's full
width, even if the title is already truncated.
Hosts without a controller retain their explicit or default chip limit.
After confirmed GraphQL tag writes, refresh only lists the normalized cache cannot
maintain so stale reads do not replace the committed selection. Match option-filtered
lists by property definition as well as sorted/grouped lists; leave unrelated lists
alone. Use the write's actual transport for refresh scope, even if the feature flag
changes while saving. REST writes retain refreshes for cache-maintained readers.
Tag chips, overflow chips, and inline tag pills retain their compact desktop
height on touch instead of adopting the shared button touch minimum. Only
the task-detail title-row tags selector uses the 36px touch target; document
title-row tags retain their compact height.

## Assignee selection

The system Assignees property uses the current team roster, plus available
agents. **Find other people…** explicitly expands to the existing Quick Access
people pool; **Back to team members** restores the roster without dropping picks.
Already-selected outsiders remain visible and removable, including references
absent from contacts. Closing and reopening starts in team mode.

This applies to task/project composers, property pills, side panels, bulk
editors, and touch picker sheets. References remain `USER` values; discovery
does not add arbitrary email addresses or CRM-only records. Company owner stays
strictly team-only, and custom people properties keep their existing pool.
`queries/team-members.ts` shares the non-suspending roster with Assignee filters.
The command-menu composer/bulk editor lives in `editor/entity-property-editor.tsx`;
its source and the row/sheet picker share `editors/selectors/scoped-user-options.ts`.
Removing an outsider removes that row from team mode immediately; finding that
person again requires explicit discovery.

## Side-panel collections

Property rows use a 4px vertical gap, including inline Tags and the boundary
between regular fields and collection fields.
Keep 16px between populated property lists and the bottom Add property action,
with spacing on the list so empty lists leave no gap above the action.
Keep property names on one line. Collection headers use available space up to
their actions, truncating only the remaining overflow; value rows retain the
shared label column.

Empty panel values use the shared `Property.Empty` icons with “No status,”
“No priority,” “Unassigned,” “No due date,” or “No project” for system fields,
and “Not set” for other fields. Host `getEmptyLabel` overrides apply to single,
multi-value, and inline fields. Empty select values remain clickable to open
their picker; empty text, number, and link values retain inline editing through
an `emptyValue` slot. Boolean toggles and separate collection headers retain
their existing empty-state behavior.

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

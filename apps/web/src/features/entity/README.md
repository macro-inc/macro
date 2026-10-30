# Entity

App-local entity feature code, including composable entity rendering,
domain-specific extractors, editing surfaces, query and mutation adapters, and
search/notification adapters. The `@entity` alias is the feature's public
app-local entry point.

`ListEntity.referencePropertyIds` opts stored reference properties into the
existing inline metadata area. Names and icons use the shared property preview
cache; the row does not search for related entities. Narrow rows compact these
pills to icons, with full names available in tooltips and the overflow menu.

Task list status and priority editing use `extractors-property/task-property-control.tsx`
in the leading icon slots before the title. Status and Urgent glyphs use 20px on
both desktop and phones; other priority glyphs use 16px on desktop and 20px on
phones, inside unchanged hit targets. Priority stays directly before the title.
The controls share the property editor and mutation path across wide task rows and narrow entity rows,
including optimistic values and rollback. Narrow rows omit duplicate trailing Status and Priority properties;
wide task rows omit the separate Status and Priority columns.
Phone task rows reserve an 8px unread-dot rail without a checkbox column and place
status and priority controls edge-to-edge while preserving their 36px touch targets
and row selection. Their 20px glyphs have a 16px gap. Trailing property icons also use
20px phone glyphs.
Other entity rows keep their existing indicator layout.
Narrow rows show the people icon beside the count for multiple assignees when
avatars are collapsed.

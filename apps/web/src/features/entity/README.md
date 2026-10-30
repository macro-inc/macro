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
in the leading icon slots before the title, with 16px glyphs on desktop and mobile
and unchanged hit targets. Priority sits directly beside the title, separated
from status by the row gap. The controls share the property editor
and mutation path across wide task rows and narrow entity rows, including optimistic
values and rollback. Narrow rows omit duplicate trailing Status and Priority properties;
wide task rows omit the separate Status and Priority columns.
Narrow rows show the people icon beside the count for multiple assignees when
avatars are collapsed.

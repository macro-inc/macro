# Entity

App-local entity feature code, including composable entity rendering,
domain-specific extractors, editing surfaces, query and mutation adapters, and
search/notification adapters. The `@entity` alias is the feature's public
app-local entry point.

`ListEntity.referencePropertyIds` opts stored reference properties into the
existing inline metadata area. Names and icons use the shared property preview
cache; the row does not search for related entities. Narrow rows compact these
pills to icons, with full names available in tooltips and the overflow menu.

Task list status editing uses `extractors-property/task-status-control.tsx` in
the leading icon slot. It shares the property editor and mutation path across
wide task rows and narrow entity rows, including optimistic status and rollback.
Narrow rows omit the duplicate trailing Status property.

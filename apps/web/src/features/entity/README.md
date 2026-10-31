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
in the leading icon slots before the title. Status and Urgent glyphs use 18px on
both desktop and phones; other priority glyphs use 16px on desktop and 20px on
phones, inside unchanged hit targets. Priority stays directly before the title.
The controls share the property editor and mutation path across wide task rows and narrow entity rows,
including optimistic values and rollback. Dedicated task rows omit duplicate trailing
Status and Priority properties and their separate columns. Mixed search rows retain a
trailing status property with an 18px icon on desktop and phones.
Phone task rows reserve an 8px unread-dot rail without a checkbox column and place
status and priority controls edge-to-edge while preserving their 36px touch targets
and row selection. Other trailing property icons use 20px phone glyphs.
Other entity rows keep their existing indicator layout.
Narrow task rows keep Project before Assignees and show one assignee avatar plus
the remaining count; do not replace the first assignee with a generic people icon.
Keep the collapsed tag-overflow chip after the title in narrow task rows,
including phones, with the existing picker and hover actions.

`ProjectBreadCrumb.collapsed` keeps a keyboard-accessible, borderless ghost folder
button with its link color and a circular icon-only target. Its hover card shows
the folder heading and full path on separate rows.
Task grids use their existing measured overflow controller to collapse folder
labels before tags or title truncation.

`OwnerLabel.iconOnly` retains owner names as accessible text and hover titles for
users, bots, teams, and unknown owners; ordinary owner labels remain unchanged.

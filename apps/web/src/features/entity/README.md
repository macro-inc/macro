# Entity

App-local entity feature code, including composable entity rendering,
domain-specific extractors, editing surfaces, query and mutation adapters, and
search/notification adapters. The `@entity` alias is the feature's public
app-local entry point.

`ListEntity.referencePropertyIds` opts stored reference properties into the
existing inline metadata area. Names and icons use the shared property preview
cache; the row does not search for related entities. Narrow rows compact these
pills to icons, with full names available in tooltips and the overflow menu.

List selection checkmarks update without animation. Selection subscriptions notify
only changed rows; task and project focus subscriptions update the old and new
rows without invalidating every visible row.

Task list priority and status editing use `extractors-property/task-property-control.tsx`
in that order before the title. Status glyphs use 18px on desktop
and phones; priority glyphs use 16px on desktop and 20px on phones and never
flex-shrink. Hit targets stay unchanged. Status stays directly before the title.
The controls share the property editor and mutation path across wide task rows and narrow entity rows,
including optimistic values and rollback. Dedicated task rows omit duplicate trailing
Status and Priority properties and their separate columns. Mixed search rows retain a
trailing status property with shared responsive property-icon sizing.
Phone task rows reserve an 8px unread-dot rail without a checkbox column and place
status and priority controls edge-to-edge while preserving their 36px touch targets
and row selection. Other trailing property icons use 20px phone glyphs.
Other entity rows keep their existing indicator layout.
Narrow task rows keep Project before Assignees. Show both avatars for exactly
two assignees; larger groups show the first avatar and the remaining count.
Reserve a fixed-width slot and anchor its first avatar left so overflow grows
right without shifting other properties. Keep the single tag or collapsed
multi-tag chip after the title, including phones, with the existing picker and
hover actions.

Trailing row actions replace the date on hover and keyboard focus. The hidden
date must not reserve width, so the star stays beside the available actions
even when a sent-only email has no Unarchive action.

`ProjectBreadCrumb.collapsed` keeps a keyboard-accessible, borderless ghost folder
button with its link color and a circular icon-only target. Its hover card shows
the folder heading and full path on separate rows.
The list folder glyph is 16px on desktop and 20px on phones, matching neighboring
property icons while keeping its existing pill and touch target.
Task grids use their existing measured overflow controller to collapse folder
labels before tags or title truncation.

`OwnerLabel.iconOnly` retains owner names as accessible text and hover titles for
users, bots, teams, and unknown owners; ordinary owner labels remain unchanged.
Pass `OwnerLabel.iconClass` to size the owner glyph at the call site; the override
applies consistently to user, bot, team, and unknown owners.
Compose persistent trailing metadata through `NarrowLayout` children, before
standard row actions and properties; keep feature-specific rendering and styling
in the caller.

---
description: "Context menus, more menus, and action sheets share semantic groups and an entity-owned ordered action list."
paths:
  - "apps/web/src/**/*.ts"
  - "apps/web/src/**/*.tsx"
globs: "apps/web/src/**/*.ts,apps/web/src/**/*.tsx"
alwaysApply: false
---

# Group action menus in one order

- Order action sections as Open, Most used, Copy, Modify, Share and export, State, Info, then Delete.
- Promote only the entity's one to three frequent actions; keep all copy variants together and place Rename, appearance, Duplicate, Move, tags, and property edits in Modify.
- Keep Download, Export, Print, and Send in Share and export; put Share in Most used only when it is a frequent action.
- Keep Archive, Mute, Hide, Leave, completion, and snooze in State unless explicitly promoted; keep Details, History, Activity, and developer actions in Info.
- Isolate destructive Delete and Remove actions last with danger styling; never append unrelated actions after them.
- Build one ordered, permission-filtered action list per entity in core or primitives; render desktop and phone from it with `groupMenuItems` in `@core/menu/group-menu-items`.
- Preserve handlers, permission and feature gates, disabled reasons, shortcuts, clipboard feedback, and desktop submenus when regrouping.
- Render nonempty desktop groups with Dropdown or ContextMenu group parts and their existing separators; render phone groups with MobileDrawer.Section and gaps, without hairline dividers.
- Omit group labels unless the menu already has them; preserve view-choice sections and user-ordered navigation separately from entity actions.
- Keep small, already-ordered menus and value, filter, creation, and navigation pickers unchanged; do not infer action groups from translated labels or DOM.
- Test group order and existing availability conditions for every changed entity list.

Check: Run the changed lists' unit tests and `just check`; inspect each changed desktop menu and its 390×844 touch counterpart.

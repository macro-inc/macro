# Email view

## What it is

Mail's list view: desktop sidebar and header, mobile pills and filter drawer,
the Soup-backed thread list, and saved email views (flag
`enable-email-saved-views`).

## Start here

- `email-view-context.tsx`: view state, tab and thread navigation, the
  `mail.savedView` URL id, and saved-view selection.
- `queries/email-query.ts`: each tab's or saved view's Soup `ef` filter.
- `queries/use-email-query.ts`: list, search, read admission, local drafts.
- `filters/email-saved-view.ts`: the `kind: "email"` definition codec: strict
  capture, permissive read with skipped-setting issues, materialization,
  canonical comparison, scope resolution, and each tab's own filters.
- `filters/use-email-filters.tsx`: the Filters model shared by the desktop menu
  and the mobile drawer; each group is a field read from and written into the
  list's filters, active once it differs from what Clear returns to.
- `components/EmailFilterFields.tsx`: the builder's People and Subject
  editors; the mobile drawer shares People.
- `primitives/create-email-saved-view-draft.ts`: confirmed baseline, dirty
  state, and revision-aware reconciliation.
- `views/email-saved-views.tsx`: sidebar section, mobile picker, menus, the
  builder dialog, header actions, unavailable and skipped-setting states.

## Gotchas

- Keep tags in the desktop Filters menu and mobile filter drawer, not in the
  sidebar; filter changes stay on the current tab.
- A saveable tab is a built-in view: it starts from its own restrictions
  (`emailTabFilterState`) as facets plus `state.conditions`, which the Filters
  menu edits like a view's. `emailTabRefinements` keeps the tab's own query
  while those restrictions stand; otherwise the list queries as a view. Write
  filters through `setFilters`/`clearFilters`, never by emptying facets.
- A saved view opens on All. Its Read status, Done, attachment, calendar, tag and
  inbox filters live in the normal state so the Filters menu, inbox picker,
  and read admission keep working; its other conditions live in
  `state.conditions`.
- Never query while a selected view is loading or unavailable: that lists all
  mail under the view's name.
- Keep inbox reconciliation off while a view is open; an inbox no longer
  linked matches nothing instead of widening to every inbox.
- `beforeSavedView` restores the prior tab and inboxes on leaving, and is what
  local and entry persistence save while a view is open; never persist view
  filters as the user's own.
- Search inside a view intersects search hits with the view's own GraphQL
  predicate, as aliases do; local working copies are left out.
- Build participant and subject ORs as balanced trees; a flat OR exceeds the
  ingress depth limit.
- Unread dots are presence in a small first unread page per view, never a count.
- `/` and Cmd+F are registered for the whole desktop view in
  `use-email-search-hotkeys.ts`, not in the list header: a thread or a new
  email unmounts that header, and a `/` with no Email command falls through
  to the app sidebar's Search view. With the header unmounted, `/` opens the
  sidebar's search field; Cmd+F stays unhandled so the browser can find text
  in the thread or draft.
- `ViewShell.Main` holds the list at the width `use-reading-pane-list-width.ts`
  reads beside the reading pane, so every drag must be saved through
  `onWidthChangeEnd`; an unsaved one snaps back on the next resize.

## Checks

Run from `apps/web`:

- `bun run test src/features/email-view src/features/saved-views`
- `bun run type-check`

## Related

- `docs/design/saved-views.md` and `docs/agent-guide/email.md` at the
  repository root.

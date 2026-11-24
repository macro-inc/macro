# Email view

## What it is

Mail's list view: desktop sidebar and header, mobile pills and filter drawer,
the Soup-backed thread list, and saved email views.

## Start here

- `email-view-context.tsx`: view state, tab and thread navigation, the
  `mail.savedView` URL id, and saved-view selection.
- `queries/email-query.ts`: each tab's or saved view's Soup `ef` filter.
- `queries/use-email-query.ts`: list, search, read admission, local drafts.
- `queries/email-search.ts`: the search service request for a search's scope
  (all mail, or the view an `in:` filter names) and the list's filters.
- `views/mobile/email-search.tsx`: the touch search page's field and Cancel
  (`EmailMobileSearchField`) and the rows under it
  (`EmailMobileSearchSuggestions`); the mobile layout in `email-view.tsx` opens
  it from the search pill, puts the field in place of the list pane's pill
  row, and keeps the list mounted below it. The search pill and filter drawer
  stay to the right of the scrolling tabs while the sidebar toggle stays on
  the left. `primitives/create-email-mobile-search.ts` owns whether the page is
  open, and ends its search whenever it closes. `views/mobile/email-tabs.tsx`
  is the pill row's tabs.
- `components/EmailDetailView.tsx` and `components/EmailComposeRouteView.tsx`:
  entries for a thread and a new email inside Mail. They hold the state and
  switch between the desktop views (`views/email-detail.tsx`,
  `views/email-compose-route.tsx`) and the touch ones in `views/mobile/`,
  which host the thread's or composer's own mobile header in the pane's top
  bar through `SplitHeaderScope`.
- `primitives/email-row-style.ts`: the Minimalist/Classic row style chosen in
  Settings → Email, a per-device preference passed to each row as
  `ListEntity.rowStyle`; phones always get Minimalist.
  `components/EmailRowStylePreview.tsx` draws Settings' inert sample of it
  with the real row, restoring Mail's list tokens that the settings card
  overrides.
- `primitives/create-search-scroll-reset.ts`: a new search starts at the top
  once its own results replace the rows kept on screen.
- `search/`: the `in:<view>` filter (`email-search-scope.ts`: parsing, the
  operator runs the field draws and the views it names), recent searches (`recent-searches.ts`,
  per person in browser storage) and the rows the search field lists, views
  while `in:` is typed and recent searches otherwise
  (`create-email-search-suggestions.ts`, drawn by
  `components/EmailSearchSuggestionList.tsx`), behind
  `enable-email-wide-search`. Operators are drawn by the shared
  `components/view-shell/search-operator-text.tsx`.
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
- `views/email-saved-views.tsx`: sidebar section, menus, the builder dialog,
  header actions, unavailable and skipped-setting states. Saved-view rows use
  the shell's sidebar layout to choose drag or, in the navigation sheet,
  Move up and Move down. The unnamed mail-folder group, Library, and Saved views
  use shared `ViewSidebar` ordering with per-account local preferences; Accounts
  is explicitly pinned above those sections.
- Saved-view creation uses the shared `create-saved-view-creation` lifecycle and route-owned `SavedViewDraftHost` leave protection.

## Gotchas

- Append each new or duplicated view as a selected draft after saved email views; retain builder name, sharing, and filters until Save or Discard, and confirm leaving dirty new drafts without prompting for saved-view edits.
- Keep saved-view appearance live in sidebar rows and breadcrumbs even with unsaved filters; expose owner-only Change icon in the shared menus behind `enableEntityAppearance`.
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
- A search reaches all mail from every tab but Spam and Trash; only an `in:`
  filter in its text narrows it, through `EmailDataSourceInput.searchScope`,
  never `tab`. The tab's own slice is dropped; the Filters menu, inbox picker,
  alias and an open saved view's conditions are kept. Focus, Scheduled and
  Reminders hand their rows to the search while it runs. `setTab` during a
  search narrows it to the tab's view instead of leaving it, except
  Scheduled, Reminders, Spam and Trash, which have no view in the search
  index and end the search, as any tab does while no words are typed; the
  sidebar and the header read `shownTab` (the view a search runs in;
  `search`, which selects nothing, without an `in:`), never `state.tab`.
- The Focus, Signal and Noise tabs read `showsInboxTabs`: they never show
  while the search field holds a query, an `in:` of the Inbox included, on
  desktop or phone.
- Text with no words (`in:`, `in:se`, `in:sent `) runs no search of its own:
  `parsedSearch` stays on the last search that had words, or empty (the open
  tab's list) when there was none. The list, the header, the sidebar and the
  empty state all read it, so they describe the rows on screen. What works on
  the typed text (narrowing a search, suggestions) parses that instead.
- Search inside a view intersects search hits with the view's own GraphQL
  predicate, as aliases do; local working copies are left out.
- Build participant and subject ORs as balanced trees; a flat OR exceeds the
  ingress depth limit.
- The data source keeps the previous rows while a search loads only when
  asked (`keepRowsWhileSearching`) and reports it as `showsPreviousRows`; they
  never cross a tab change, and `isLoading` stays false while they show, so
  gate "loading" UI on both.
- Unread dots are presence in a small first unread page per view, never a count.
- Cmd+F is registered for the whole desktop view in
  `use-email-search-hotkeys.ts` and focuses the list header's field through
  `registerListSearch`; while a thread or a new email has replaced that
  header it stays unhandled, so the browser can find text in the thread or
  draft. Email binds no `/`; as in every other view, it opens the app
  sidebar's Search view.
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

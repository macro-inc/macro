# Tasks view

## Scope

Main Tasks and reusable task-list hosts. Projects and CRM embed `TasksViewProvider`; only `TasksView` mounts saved-view sources, without a feature-local GraphQL provider.

## Start here

- `tasks-view.tsx` and `tasks-view-context.tsx`: independent saved-view list/detail query composition, filter state, router integration, and task-list source ownership.
- `filters/task-saved-view.ts`: strict capture and permissive reading of supported filters, with diagnostics for skipped conditions.
- `primitives/create-task-saved-view-draft.ts`: task encoding and confirmed tag bindings over `saved-views/primitives/create-saved-view-draft.ts`, which owns dirty state, retained edits, and revision-aware reconciliation.
- `components/TasksDetailView.tsx`: the entry for a task open inside Tasks;
  it switches between `views/task-detail-pane.tsx` (breadcrumbs, Share,
  Info) and `views/mobile/task-detail-pane.tsx`, which hosts the task's own
  mobile header through `SplitHeaderScope`.
- `views/task-saved-views.tsx`: compound sidebar/mobile lists, filter summaries, imperative action dialogs, and request-scoped write/reload completion; the Tasks host owns selection and navigation.
- `queries/use-tasks-query.ts`: shared list, board, Gantt, and search filtering.
- `@queries/properties/graphql/task-dependency-source`: normalized task facts; REST search rows hydrate missing facts in 500-ID batches without changing search order or index-based filter membership. Detail blocker names/statuses use the shared batched preview source.
- Keep search rows available without enrichment badges when dependency enrichment fails; expose only primary search errors, and replace all canonical Status/Depends On/Blocking assignments while preserving unrelated properties.

## Gotchas

- Group task lists by the Project property, matching the Project column and Board. The server labels project groups with the initiative name the viewer can read, and the cache's local grouping projection carries that label; a header resolves the name through the authorized project identity query only while its group is still labeled by its key. Projects sort by name with No Project last in every layout.
- Keep Priority groups in Urgent, High, Medium, Low order with unset priority last through the shared Soup group comparator; group presentation does not follow item sort direction or stored option display order.
- Filter tasks by Project through the existing Project entity-reference property, with OR within projects and AND across facets; keep IDs in saved views and entry state, use the authorized paged project picker source (including read-only projects), and omit the facet in a single-project host. No project and AI project resolution remain unsupported.
- Place saved task views directly below built-in task views and saved project views below built-in project views; end each list with Create view, without separate saved-view headings or empty-state cards.
- Wrap task navigation and its saved views in the headerless `views` sidebar section; keep project navigation and its saved views in the collapsible `projects` section so shared per-account section ordering moves each group together on desktop and touch.
- Keep built-in task and project navigation icons in `components/task-view-icons.tsx`; reuse that mapping without importing the sidebar.
- Preserve project scope through detail navigation, history, pagination, and editable-filter clearing; keep project views out of task queries and saved-task-view capture. Key the stateful Tasks workspace by its Tasks/Projects restoration destination so explicit route restoration stays independent.
- Align wide desktop group-header glyphs with the first row control; keep caret containers square and preserve each header's caret-to-content gap and value-icon slot across widths without changing padding, the 44px touch target, or the layout-neutral border.
- Keep `soup-list` on list roots for shared row geometry; truncate long group labels instead of wrapping.
- Pin the current list group header only on desktop until the next header replaces it; let touch group headers scroll normally while retaining collapse controls and keyboard navigation.
- Embed task rows in a host page with `scrollContainer` and `scrollStart`; keep the host's measured header inset and summary outside virtual rows, and preserve the default internal scroller elsewhere.
- Keep desktop and tablet task rows on the shared column grid at every pane width with `ListColumnHeader` cells; use the headerless `NarrowRowGrid` layout only on phones.
- Set task-list horizontal padding from its container width: 8px below 640px, 12px from 640px, and 4px on phones.
- Render phone task rows with the narrow layout, an 8px unread-only rail, no checkbox column, 4px outer list padding, and 44px row height; preserve row selection handlers and 36px property-editor touch targets.
- Keep leading task status icons at 18px and priority icons at 16px desktop/20px phone without flex shrinking; use 16px Status/Priority selector icons, the shared 12px property default elsewhere unless a surface overrides it, and preserve 16px group-header carets and existing hit targets.
- Give list Due date glyphs the shared 12px base size and the existing 16px compact-column override; never leave calendar SVG dimensions implicit.
- Mix light-theme due-date warnings with 40% foreground in list and board values for contrast; keep dark-theme warnings, global warning tokens, and status colors unchanged.
- Use the matching `task-status-*` theme token for each status icon and group-header tint; default Completed to accent while preserving explicit theme overrides and independent global colors.
- Edit priority then status through leading `TaskPropertyControl` icons on desktop and mobile; share their presentation through `PropertyIconControl`, place status directly beside the title, and keep separate Status/Priority columns and duplicate trailing mobile pills removed.
- Read Blocked from GraphQL dependency facts, not a new Status option; use `TaskBlockedBadge` across desktop rows, phone rows, and board cards, and the shared dependency strip in Markdown task details.
- Order trailing task properties as Due date, Project, then Assignees in wide and narrow rows and title pills; show both avatars for exactly two compact assignees, otherwise one avatar plus the remaining count, anchored left in a fixed-width slot so overflow grows right.
- At container widths up to 840px, use tooltip-labeled icons for Project, Assignees, Due date, and Updated headers; keep Project at 32px and Assignees at 44px, with the assignee header aligned to the first avatar and collapsed property pills padded 4px on both axes.
- While a text search keeps the search service's order (`TasksDataSource.sortsSearchResults` false), column headers stop sorting and show a static Updated descending arrow; CRM's scoped search reruns the list's query and keeps sortable headers. The Sort dropdown and S hotkey drop out during any search. Never change the stored sort for search.
- Size Updated from its measured, untruncated header with a 56px content minimum for single-line timestamps; share the width across rows, retain existing Created by spacing, and fade/collapse Updated over 160ms at 600px, disabling motion for reduced-motion preferences.
- Keep Created by visible above 600px alongside Updated, with a 16px user-plus header icon, unclipped 20px owner avatars at container widths up to 840px, and a keyboard-focusable “Created by” tooltip; show the title's shared badge only while the creator column is hidden, with a 4px layout gap after the title.
- Scope task-only column widths with `.task-grid-row.task-grid-icon-creator` so shared Soup `.task-grid-row` rules cannot override them when stylesheets load in a different order.
- Pass enabled grid columns as a typed ordered array; default Project before Assignees and derive full-row spans from the same array.
- Include each visible task cell's 8px leading inset inside its track and keep the grid's column gap at zero so hidden metadata columns reserve no space.
- Reuse `PropertyEmptyIcon` for absent values in list rows, board cards, and group or board-column headers: 30%-opacity wide priority bars, a dashed user circle, a corner-dashed project cube, and a slashed calendar for no due date; use the regular cube for set projects.
- Use shared ghost-button interaction styling for editable list properties; dim empty icons and labels without applying opacity twice to No priority.
- Register task-row collapse items with the shared `src/components/priority-collapse/` controller and sensor, not split-layout wrappers.
- Show at most three individual tag chips; keep a sole tag as its named chip even in collapsed layouts, otherwise collapse the folder path first, then more tags on measured overflow, and truncate the title last while preserving open tag editors; re-evaluate new tags when editing ends without requiring a resize.
- Keep the tag chip or collapsed multi-tag overflow after the title on phone rows instead of dropping tags with the desktop columns.
- Keep the touch sidebar button on the left and Search/Filters on the right; task views, projects, and saved views live in the sidebar sheet. `CollectionPanes` retains the list beside task/project details on wide touch.
- Tab and Shift+Tab cycle sidebar tabs only over a list. Keep `TasksSidebar`'s key-time check for an open project or task: the sidebar remounts whenever the view crosses its layout breakpoint, so it registers after an open pane and eclipses any override the pane holds.

- Save filters, relative due dates or valid calendar bounds, selected layout, grouping, and ordered sort directions; keep text search and scroll state local, and capture implicit person conditions as normal OR-valued facets.
- Preserve stable tag/property bindings when labels disappear; skip unsupported or malformed conditions without discarding supported filters.
- Label the semantic viewer token Me, explain it with “Matches whoever opens this saved view,” and resolve it only when executing a filter; a selected fixed user stays fixed.
- Limit new Assignee choices to team members and available agents without contact discovery; reuse existing selected-first ordering at opening and keep rows stable while selecting; preserve selected outsiders, the semantic Me token, Unassigned, and broad Created by options.
- Keep saved views on All Tasks with every restriction in editable facets; accept only the final v1 person-filter format, without a separate Scope control.
- Do not persist temporary saved-view filters, including due-date predicates, in entry snapshots; detail navigation discards those edits but retains the saved-view ID.
- Pass saved-view state through the existing Tasks search codec; split URLs namespace it as `s0.tasks.savedView`.
- Keep embedded Project/CRM task consumers free of saved-view management.
- Show filled Save view and Save changes actions; place mobile creation in a borderless, edge-to-edge info banner overlaying filter content immediately above the footer with unpunctuated copy and a leading bookmark icon on its button only when filters, due date, layout, grouping, or sort differ from the built-in tab defaults, excluding search.
- Render Save view and draft Cancel as separate standalone buttons; preserve their existing dialog and cancellation behavior.
- Keep sidebar actions targeted to their own record; Edit combines naming and sharing without saving temporary settings, and Duplicate starts with a prefilled private copy and warns before omitting unsupported settings.
- Keep saved-view appearance live in sidebar rows and breadcrumbs even with unsaved filters; expose owner-only Change icon in the shared menus behind `enableEntityAppearance`.
- Keep saved-view names and menus in the sidebar; overlay creation above the filter drawer footer on a drawer-colored backing without blocking the last scrollable controls, and put Save changes at the footer's right edge, opposite Clear all.
- Keep saved-view selection and creation in the shared sidebar on desktop and touch; omit header pickers and duplicate built-in tabs, and isolate Create view's keyboard scope from task-list shortcuts.
- Render touch task controls through `MobileListLayout`, reserve its top inset inside `ListViewport`, and leave the greater of bottom safe area and floating chrome plus 16px after the final row; keep touch column headings and warning rows inside the scroller.
- Use the shared task illustration and contextual empty-state panel for empty list results; keep search guidance distinct and preserve host-supplied empty content.
- Keep desktop list-header filters, layout, sort, and grouping at `md` / `icon-md` (32px), matching New and Search; preserve the mobile filter drawer.
- The Title sort sends Soup's `name` method, ascending until the viewer reverses it. Keep `sortTasks`'s local comparator on the same order — `compareSoupNames` (lower-cased ICU root order, matching the server's `und-x-icu`), unnamed last, newest update then descending ID — so loaded rows do not move while a page revalidates.
- Start every creation or duplicate with a fresh New view draft at the end of the task views list; track name, sharing, and settings until confirmed save replaces it. Confirm leaving dirty new drafts, including task navigation, through the split router with Discard or Keep editing; only clean drafts leave without asking.
- Close the selected-view menu before opening a dialog, discard deferred actions after account or selection changes, and close dialogs after account, saved-view, or built-in-tab navigation.
- Own mobile action dialogs outside closing drawers; finish drawer closure before opening a dialog, and reopen filters after cancellation only within the same navigation scope.
- Honor confirmed deletion when the same account selects the target while deletion is pending; never apply completion to another account.
- Keep malformed mutation responses separate from selected-view availability, preserve ordinary-create facets, and reject creation completions after the selected revision changes.
- Apply supported saved filters immediately and show a danger banner above results for skipped conditions; show unfiltered tasks if none apply, and never rewrite the original on load.
- Let owners explicitly remove skipped conditions from the warning banner; save only supported stored filters with revision checks, preserving temporary edits and sharing.
- Reject update completions older than either the draft or selected-detail revision, including while temporary filters are dirty.
- Default older definitions without grouping to the All Tasks default, Priority; warn on unknown grouping and block ordinary definition saves until explicit cleanup.
- Preserve the raw saved layout during mobile or flag fallbacks; capture that layout instead of the displayed list fallback.
- Block ordinary definition saves while unsupported settings remain; only explicit banner cleanup removes them, and metadata writes leave the definition unchanged.

- Mark task row notifications through `notifications/mark-row-seen.ts` when opening inline details or a split, including board and Gantt rows; keep the mounted Markdown marker for direct routes.
- Keep Assignee menus team/agent-scoped with selected outsiders; build Created by menus with lazy contact sources on desktop and mobile. Resolve saved-summary labels from that summary's explicit IDs, not active filters or a directory map.
- Keep semantic `@viewer` outside contact lookup and distinct from fixed self; preserve unknown selected IDs and group-local Only behavior.
- Extract AI person references without a prompt catalog, then resolve complete per-label evidence; reject the entire plan for unknown, ambiguous or incomplete people rather than dropping constraints. Preserve model array boundaries, literal addresses and viewer-token semantics.
- Fence planner completions by account/session, navigation and filter edits; returning to an earlier state does not revive an old request.

## Checks

Run from `apps/web`:

- `bun run test src/features/tasks-view`
- `bun run type-check`
- Bounded filters/planner browser regression: `bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts task-filters.browser.e2e.ts` (synthetic transport, real controls and reference reader).
- Project grouping browser regression: `bunx playwright test --config src/features/tasks-view/browser-test/playwright.config.ts project-grouping.browser.e2e.ts`.

## Related

- `docs/agent-guide/tasks.md` and `docs/design/saved-views.md` at the repository root.

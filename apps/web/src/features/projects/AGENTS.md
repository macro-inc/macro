# Projects

## Scope

Task projects are initiatives, not legacy Drive folders. `projects.tsx` composes authorized sources with shared task layouts and project collections.

## Start here

- `core/project.ts`: project identity, access, collection settings, and viewer-relative scopes.
- `core/project-saved-view.ts`: versioned `projects` definitions; search and scroll remain local.
- `project-saved-views.tsx`: saved-view production composition, route/account scope, and settings ownership.
- `views/project-saved-views.tsx`: shared saved-view lists, menus, dialogs, and explicit saves.
- `views/projects-collection.tsx`: collection state and desktop header; `components/project-collection-controls.tsx` lays out touch controls in `MobileListLayout`.
- `add-project-tasks.tsx`: shared creation/assignment composition; `primitives/add-project-tasks.ts` owns eligible selection, retry state, lifetime guards, and assignment tracing; platform views compose the menus.
- `project-detail.tsx` and `project-title-menu.tsx`: shared sources and actions above desktop/mobile header compositions.
- `project-row.tsx`: row entry; `views/project-row.tsx`, `views/mobile/project-row.tsx`, and `views/shared/` own responsive presentation.

## Gotchas

- Use `initiative` / `INITIATIVE` for projects; reserve `project` / `PROJECT` for Drive folders.
- Reuse shared saved-view queries, mutation dialogs, menus, and draft reconciliation; the backend already accepts the `projects` kind.
- Preserve the raw saved layout when phones display List instead of Gantt; exclude temporary saved-view edits from entry snapshots.
- Keep built-in scopes viewer-relative and independent of editable filters; sharing a definition never grants project access.
- Reject unknown nested saved-view settings and reset pending creation on account changes so unsupported restrictions and draft state cannot leak across views.
- Keep the Projects collection inside the Tasks workspace and its hamburger navigation on touch; use only the caret Back action while a project is open, keep its direct-link Projects fallback on phones and tablets, and omit a separate Projects dock destination while retaining project route restoration.
- Use the shared SplitTitleFileMenu and SplitFileMenu for project titles and replace the active desktop breadcrumb. Phones show one page with title/property pills, an expandable description of up to eight lines, shared Discussion entry, and an in-flow Tasks heading; keep Share and Details islands, render only property pills in the property row, omit section tabs, and skip obsolete same-project sections on Back. Preserve desktop and tablet tabs.
- Take the section list from `projectSections` (Time only with `enable-time-tracking`) and the shown section from `shownProjectSection`, so a `time` link with the flag known off shows Overview while a loading flag keeps Time. Time's body and the phone Time row live in `features/time-tracking/project-time.tsx`; phones mount the row under Discussion, never a tab.
- Resolve title-menu property options and edit permission reactively so late definitions and access changes update open menus; open rename/delete through the owner-bound imperative dialog host and recheck permissions before writes.
- Keep saved project views directly below built-in project scopes in the Tasks sidebar on every platform, ending with Create view instead of a separate saved-view section; use long-press options sheets on touch and hover More menus on desktop. Omit project PillTabs and saved-view pickers from headers. Keep navigation left and search/filter controls right.
- Append each fresh project-view draft after saved project views; preserve that position on saving and use the split router's before-leave hook with Discard or Keep editing before leaving a dirty new draft.
- Share `ListColumnHeader`, `NarrowRowGrid`, and task-grid tracks with task rows. Project lists order Status, Priority, Assignees, Due date, Updated; collapse values to icons at 840px and hide Updated at 600px with the shared 160ms reduced-motion-aware transition. Touch lists omit column headers; tablet rows also omit checkbox and Updated tracks. Keep the saved `EntityIcon` before the name and an accessible 14px progress ring after it, with a 22px tooltip target; use a 20px ring in the phone Tasks heading. On phones, trail Status, Priority, and one lead avatar using existing property editors, with the task rows' dashed-user placeholder for no assignee.
- Use one Add task dropdown on desktop and a filled PillButton in centered empty states. On phones, keep one page-owned floating Task menu visible at rest and while scrolling; omit inline and empty-state task buttons, keep the empty description and Documentation link, and pad the list above the floating chrome. Projects-list creation remains separate.
- Register project Copy link/Copy ID commands only for Overview; keep task-row commands in Tasks and retain the project-specific floating action on tablet Overview.
- Resolve the phone Projects creation action with `TOKENS.create.initiative`; `TOKENS.create.project` creates a Drive folder.
- Compose phone rows in the page's scroller with the shared task list's external scroll host; include the measured header inset in the summary and virtualizer's start margin, and let the Tasks heading and group headers scroll with the page.
- Host project route headers in SplitHeaderScope like task details so collection panes measure their own islands; reserve the greater of bottom safe area and floating chrome plus 16px after the final row.
- Fit nonempty phone descriptions to the largest five-to-eight-line preview that leaves the Tasks heading and 24px of its first row above floating chrome; keep measuring edits so Show more/Show less stays accurate.
- Leave empty phone descriptions unclamped without disclosure; keep the editor placeholder in normal flow so its full text reserves space above Discussion.
- Reuse `components/discussion/` for the phone Discussion entry and fixed-height sheet; keep existing conversation queries, permissions, paging, and desktop inline threads.
- Choose the task empty state from the authorized project's unfiltered task IDs before consulting layout queries; retain filtered-empty results when linked tasks exist. Center both project and task empty states in EmptyStatePanel with PROJECTS_DOCS_URL documentation; filtered project results offer Clear Filters without changing the built-in scope.
- Keep the Add task menu and Documentation in desktop filtered-empty task lists as well as genuinely empty projects; retain their distinct messages and hide writes for read-only viewers.
- Keep existing-task assignment failures selected for retry and reject stale completion after the project or picker lifetime changes.
- Use PickerSheet for touch Add existing tasks, with search and actions pinned around a filling list; use accent InlineCheckbox rows, eligible-selection counts, stable selection order, 16px group gaps, and no dividers.
- Capture read-only property-cell clicks as project navigation before inert property triggers swallow the event; leave editable cells to their property editors.

## Checks

Run from `apps/web`:

- `bun run test src/features/projects src/features/tasks-view src/features/saved-views src/components/app/mobile`
- `bun run type-check`
- `bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts task-filters.browser.e2e.ts`

Run `just check` from the repository root.

## Related

- `docs/agent-guide/tasks.md`
- `docs/design/saved-views.md`

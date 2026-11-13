# Projects

## Scope

Task projects are initiatives, not legacy Drive folders. `projects.tsx` composes authorized sources with shared task layouts and project collections.

## Start here

- `core/project.ts`: project identity, access, collection settings, and viewer-relative scopes.
- `core/project-saved-view.ts`: versioned `projects` definitions; search and scroll remain local.
- `project-saved-views.tsx`: saved-view production composition, route/account scope, and settings ownership.
- `views/project-saved-views.tsx`: shared saved-view lists, menus, dialogs, and explicit saves.
- `views/projects-collection.tsx`: desktop collection; `projects-mobile-tabs.tsx` and `projects-filter-drawer.tsx` compose phone controls.
- `add-project-tasks.tsx`: shared creation/assignment state; `views/add-project-tasks.tsx` and `views/mobile/add-project-tasks.tsx` compose the menus.
- `project-detail.tsx` and `components/project-title-menu.tsx`: shared sources and actions above desktop/mobile header compositions.
- `components/project-row.tsx`: row entry; `views/project-row.tsx`, `views/mobile/project-row.tsx`, and `views/shared/` own responsive presentation.

## Gotchas

- Use `initiative` / `INITIATIVE` for projects; reserve `project` / `PROJECT` for Drive folders.
- Reuse shared saved-view queries, mutation dialogs, menus, and draft reconciliation; the backend already accepts the `projects` kind.
- Preserve the raw saved layout when phones display List instead of Gantt; exclude temporary saved-view edits from entry snapshots.
- Keep built-in scopes viewer-relative and independent of editable filters; sharing a definition never grants project access.
- Keep Projects separate from Tasks in phone navigation while reusing the Tasks workspace for project details and push/back history.
- Use the shared SplitTitleFileMenu and SplitFileMenu for the project detail title. On phones, tapping the title island opens the actions-only file-menu drawer; retain the existing Overview/Tasks tabs outside the drawer and keep desktop tabs unchanged.
- Resolve title-menu property options and edit permission reactively so late definitions and access changes update open menus.
- On phones, keep one title island for the selected project view before the filter island. Group built-ins and saved views in the picker as 48px cards, with accent selection, shared marks, actions, and New view at the bottom; defer navigation and dialogs until sheet closure.
- Share `ListColumnHeader`, `NarrowRowGrid`, and task-grid tracks with task rows. Project lists order Status, Priority, Assignees, Due date, Updated; collapse values to icons at 840px and hide Updated at 600px with the shared 160ms reduced-motion-aware transition. Keep the saved `EntityIcon` before the name and an accessible 14px progress ring after it, with a 22px tooltip target; on phones, trail Status, Priority, and one lead avatar using existing property editors.
- Use one Add task dropdown on desktop and a filled PillButton in centered empty states; both offer New task and Add existing tasks. Keep the phone floating Task control on MobileCreateMenu with stacked actions, retain edit gates, and keep it available in empty projects.
- Choose the task empty state from the authorized project's unfiltered task IDs before consulting layout queries; retain filtered-empty results when linked tasks exist. Center both project and task empty states in EmptyStatePanel with PROJECTS_DOCS_URL documentation; filtered project results offer Clear Filters without changing the built-in scope.
- Keep existing-task assignment failures selected for retry and reject stale completion after the project or picker lifetime changes.
- Capture read-only property-cell clicks as project navigation before inert property triggers swallow the event; leave editable cells to their property editors.

## Checks

Run from `apps/web`:

- `bun run test src/features/projects src/features/tasks-view src/features/saved-views src/components/app/mobile`
- `bun run type-check`
- `bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts task-filters.browser.e2e.ts`
- `bunx playwright test --config src/features/projects/browser-test/playwright.config.ts`
- `bunx playwright test --config src/features/projects/browser-test/title-playwright.config.ts`

Run `just check` from the repository root.

## Related

- `docs/agent-guide/tasks.md`
- `docs/design/saved-views.md`

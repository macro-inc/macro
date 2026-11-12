# Projects

## Scope

Task projects are initiatives, not legacy Drive folders. `projects.tsx` composes authorized sources with shared task layouts and project collections.

## Start here

- `core/project.ts`: project identity, access, collection settings, and viewer-relative scopes.
- `core/project-saved-view.ts`: versioned `projects` definitions; search and scroll remain local.
- `project-saved-views.tsx`: saved-view production composition, route/account scope, and settings ownership.
- `views/project-saved-views.tsx`: shared saved-view lists, menus, dialogs, and explicit saves.
- `views/projects-collection.tsx`: desktop collection; `projects-mobile-tabs.tsx` and `projects-filter-drawer.tsx` compose phone controls.
- `views/project-task-actions.tsx` and `views/add-project-tasks.tsx`: project task creation and existing-task assignment.

## Gotchas

- Use `initiative` / `INITIATIVE` for projects; reserve `project` / `PROJECT` for Drive folders.
- Reuse shared saved-view queries, mutation dialogs, menus, and draft reconciliation; the backend already accepts the `projects` kind.
- Preserve the raw saved layout when phones display List instead of Gantt; exclude temporary saved-view edits from entry snapshots.
- Keep built-in scopes viewer-relative and independent of editable filters; sharing a definition never grants project access.
- Keep Projects separate from Tasks in phone navigation while reusing the Tasks workspace for project details and push/back history.
- Share `ListColumnHeader`, `NarrowRowGrid`, and task-grid tracks with task rows. Project lists order Status, Priority, Assignees, Due date, Updated; collapse values to icons at 840px and hide Updated at 600px with the shared 160ms reduced-motion-aware transition. Keep the saved `EntityIcon` before the name and an accessible 14px progress ring after it, with a 22px tooltip target; on phones, trail Status, Priority, and one lead avatar using existing property editors.
- Use the combined New task split button on desktop and the floating create menu on phones; retain the current project's edit gate.
- Show the project task empty state only when the project has no tasks, not when filters hide linked tasks.
- Keep existing-task assignment failures selected for retry and reject stale completion after the project or picker lifetime changes.

## Checks

Run from `apps/web`:

- `bun run test src/features/projects src/features/tasks-view src/features/saved-views src/components/app/mobile`
- `bun run type-check`
- `bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts task-filters.browser.e2e.ts`
- `bunx playwright test --config src/features/projects/browser-test/playwright.config.ts`

Run `just check` from the repository root.

## Related

- `docs/agent-guide/tasks.md`
- `docs/design/saved-views.md`

# Tasks view

## Scope

Main Tasks and reusable task-list hosts. Projects and CRM embed `TasksViewProvider`; only `TasksView` mounts saved-view sources, without a feature-local GraphQL provider.

## Start here

- `tasks-view.tsx` and `tasks-view-context.tsx`: independent saved-view list/detail query composition, filter state, router integration, and task-list source ownership.
- `filters/task-saved-view.ts`: strict capture and permissive reading of supported filters, with diagnostics for skipped conditions.
- `primitives/create-task-saved-view-draft.ts`: confirmed filter/layout/grouping/sort snapshots, dirty state, skipped-setting diagnostics, and revision-aware reconciliation; receives only the detail source, without navigation, mutation, or dialog state.
- `views/task-saved-views.tsx`: compound sidebar/mobile lists, filter summaries, imperative action dialogs, and request-scoped write/reload completion; the Tasks host owns selection and navigation.
- `queries/use-tasks-query.ts`: shared list, board, Gantt, and search filtering.

## Gotchas

- Save filters, selected layout, grouping, and ordered sort directions; keep text search and scroll state local, and capture implicit person conditions as normal OR-valued facets.
- Preserve stable tag/property bindings when labels disappear; skip unsupported or malformed conditions without discarding supported filters.
- Label the semantic viewer token Me, explain it with “Matches whoever opens this saved view,” and resolve it only when executing a filter; a selected fixed user stays fixed.
- Keep saved views on All Tasks with every restriction in editable facets; accept only the final v1 person-filter format, without a separate Scope control.
- Do not persist temporary saved-view filters in entry snapshots; detail navigation discards those edits but retains the saved-view ID.
- Pass saved-view state through the existing Tasks search codec; split URLs namespace it as `s0.tasks.savedView`.
- Keep embedded Project/CRM task consumers free of saved-view management.
- Show filled Save view and Save changes actions; place mobile creation in a borderless, edge-to-edge info banner overlaying filter content immediately above the footer with unpunctuated copy and a leading bookmark icon on its button only when filters, layout, grouping, or sort differ from the built-in tab defaults, excluding search.
- Keep sidebar actions targeted to their own record; Edit combines naming and sharing without saving temporary settings, and Duplicate starts with a prefilled private copy and warns before omitting unsupported settings.
- Keep saved-view names and menus in the mobile picker; overlay creation above the filter drawer footer on a drawer-colored backing without blocking the last scrollable controls, and put Save changes at the footer's right edge, opposite Clear all.
- Place the saved-view picker after Filters and before built-in mobile tabs; omit duplicate headers and general create controls, but offer Create view in the empty state.
- Group the shared sidebar and picker empty state in a subtly bordered, rounded container with 12px padding, the inherited background, and no shadow: “Your go-to views”, “Save your setup for next time.” and a neutral Create view button with a leading plus icon, without a separate illustration; keep the sidebar header's icon-only plus available in every section state, and isolate both creation buttons' keyboard scopes from task-list selection shortcuts.
- Keep mobile pills in a flex wrapper inside the header so their shadow margins cannot collapse the header and overlap task content.
- Show one local New view draft row after creation starts; prefill its save dialog with New view, replace the row on confirmed save, and remove it on cancellation or navigation without adding fake cached records.
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

## Checks

Run from `apps/web`:

- `bun run test src/features/tasks-view`
- `bun run type-check`

## Related

- `docs/agent-guide/tasks.md` and `docs/design/saved-views.md` at the repository root.

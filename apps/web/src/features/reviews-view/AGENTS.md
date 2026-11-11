# Reviews view

## What it is

GitHub pull request lists and details, with desktop sidebar navigation and
mobile scope tabs.

## Start here

- `reviews-view.tsx`: list and detail composition, scope, filters, and navigation.
- `components/ReviewsSidebar.tsx`: scope destinations, favorites, and agents.
- `components/ReviewsControls.tsx`: desktop filters and mobile filter drawer.
- `queries/use-reviews-facets-query.ts`: repository, author, assignee, and label options.

## Gotchas

- Keep GitHub labels in the desktop filter menu and mobile filter drawer, not
  in the sidebar. Reviews does not filter by Macro tags.
- Keep the Agents sidebar destination separate from the Started from filter:
  choosing a sidebar agent opens the list if a pull request detail is active.

## Checks

Run from `apps/web`:

- `bun run test src/features/reviews-view`
- `bun run type-check`

## Related

- `docs/agent-guide/pull-requests.md` at the repository root.

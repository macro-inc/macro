# Pull request detail

## What it is

The PR feature owns the Reviews-hosted and standalone PR page, with Overview
and Changes tabs over stored GitHub data. Legacy components remain in the tree
for reference; the routed page uses the redesigned composition.

## Start here

- `route-views.tsx`: standalone route entry.
- `context/pr-page-read-model.ts` and `pr-page-actions.ts`: typed read and write contracts.
- `queries/pr-page-source.ts`: production adapter and development-sample boundary.
- `pr-page.tsx`: production entry and the single desktop/mobile switch.
- `views/shared/pr-page-content.tsx`: shared content background, page scroller, and sticky tabs.
- `views/pr-page-top-bar.tsx`: always-visible desktop title/actions and anchored Details.
- `views/pr-slim-bar.tsx`: option C's status strip and shared band tab row.
- `primitives/create-pr-page-layout.ts`: measured docking mode and saved Details preference.
- `data/queries.ts`: stored PR detail adapter.
- `data/pr-changes.ts`: storage changeset and patch adapter.
- `primitives/create-pr-actions.ts`: existing merge, draft, and state writes.
- `views/PrDetail.tsx`: retained legacy implementation and integration helpers.

## Scope

- Owns the PR header, Overview conversation, merge status, Details surfaces,
  and PR-specific Changes layout.
- Shared diff rendering belongs to `components/diff-view`.
- Agent-session Changes belongs to `features/changes`; preserve its behavior.

## Gotchas

- Measure docking and compact layouts against the PR pane, never the window.
- Keep one typed page read model and actions contract; expose missing backend
  capabilities as absent data and unavailable actions, never optimistic fiction.
- Treat backend additions as optional until their data-layer change is present.
- Restrict synthetic samples to the existing local/hosted development check;
  sample actions must not call live mutations.
- Reuse heading-free lists at compact (30px) and touch (44px) density; put section
  chrome in each consumer.
- Keep the lifecycle status icon independent of checks/review band tint.
- Anchor floating Details to its toggle and keep its transient state separate from the docked Overview preference.
- Open title checks in a checks-only dialog and show five pending-first rows before expansion.
- Keep the normal top bar visible; use option C's full-width status strip after the measured title/pill boundary, never directional hide/reveal.
- Use one page scroller and background for Overview and Changes; keep toolbars, file headers, and the tree sticky against it.
- Size title/actions with real DOM flex wrappers; desktop HeaderIsland returns a fragment and drops layout classes.
- Keep checks-dialog rows 36px on desktop and 44px on touch, with a pinned header and only the list scrolling.
- Keep one full-width band fade behind transparent title/pills/tabs; give only the scrolled strip its own fill, fade, and border.
- Preserve GitHub Markdown normalization, image handling, thread grouping,
  notification reads, sharing, and existing action confirmations.

## Checks

- From `apps/web`, run `bun run test -- src/features/block-pr src/features/changes`.
- Run `just check` and `just check full` from the repository root.
- Extend existing test files; do not add test-only source dependencies.
- When browser checks are delegated to the user, keep the requested preview
  running and report browser/touch and connected-trace verification as skipped.

## Related

- Rules: `.agents/rules/web/`; architecture: `docs/architecture/frontend-features.md`.
- Walkthrough: `docs/agent-guide/pull-requests.md`.

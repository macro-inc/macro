# drive-view

## What it is

The Drive workspace (`/app/drive`) for browsing, organizing, searching,
previewing, sharing, and recovering files, documents, databases, forms, and
folders. The redesigned desktop and touch workspace is gated behind the
`enableDriveRedesign` (`enable-drive-redesign`) feature flag while keeping the
legacy workspace intact when the flag is off.

## Start here

- `drive-view.tsx`: composition root, shared `DriveProvider`, and feature-flag
  switch into `DriveRedesignEntry` vs legacy `DriveWorkspace`.
- `drive-redesign-entry.tsx`: single FE-70 device switch (`isTouchDevice()`)
  between `views/redesign/drive-redesign-workspace.tsx` (desktop) and
  `views/mobile/drive-redesign-mobile.tsx` (touch).
- `core/`: pure models for folder/file ordering, Browse vs All files filtering,
  time buckets, extension-preserving rename ranges, Miller column paths, undo
  entries, Trash hierarchy summaries, filter presets (`drive-filters.ts`),
  optimistic folder state (`drive-optimistic-folders.ts`), and Shared with me
  provenance partitioning (`drive-share-provenance.ts`).
- `primitives/`: reactive view preferences, inline edit coordination, Quick
  Look inspector state, undo manager, optimistic folder controller
  (`drive-optimistic-folders.ts`), and agent teammate lookup
  (`use-drive-agents.ts`).
- `components/redesign/drive-filter-bar.tsx`,
  `components/redesign/share-provenance-badge.tsx`, and
  `views/mobile/drive-redesign-mobile-filter-strip.tsx`: second-row Ask AI +
  Type / People / Modified / Source filter bars, Shared with me scope switcher
  (`All` / `Shared directly` / `Team & Channels`), and provenance badges for
  desktop and touch.
- `queries/`: Drive data sources, per-folder live contents adapter
  (`drive-folder-contents.ts`), paginated Trash adapter (`drive-trash.ts`), and
  batched viewer-relative share provenance lookup
  (`drive-share-provenance.ts`).
- `views/shared/use-drive-display-items.ts`: unified display model shared by
  desktop and touch views without crossing the FE-70 boundary.

## Scope

- Owns: Drive browsing UI, folder hierarchy presentation, view modes
  (List/Grid/Columns), Quick Look inspector, inline rename/create, undoable
  moves/trash, Starred & Trash tabs.
- Not here: GraphQL Soup list transport (`apps/web/src/lib/queries/soup/`),
  on-device GraphQL cache (`apps/web/src/lib/graphql-cache/`), Projects
  workspace (`apps/web/src/features/projects/`).

## Checks

- Unit tests: `bun run test --maxWorkers=2 src/features/drive-view/` (from `apps/web`)
- Backend-free browser suite:
  `bunx playwright test --config src/features/drive-view/browser-test/playwright.config.ts`
  (from `apps/web`)
- Static & code rules: `just check`

## Gotchas

- `SoupEntityContextMenu` sets `h-full` on its trigger by default; pass
  `as="div" class="h-auto"` when wrapping stacked list rows inside a scroller.
- `<Tooltip>` renders an `inline-flex` trigger (`min-width: auto`); pass
  `class="min-w-0 max-w-full"` or `class="min-w-0 flex-1"` around truncated text
  so long filenames ellipsize cleanly instead of overflowing sibling columns.
- Files in `views/mobile/` must obey FE-70 (`tsx-mobile-view-closed`): no
  `isTouchDevice`, no `touch:`/`not-touch:` modifiers, and shared view helpers
  must live in `views/shared/` or `components/`.

## Related

- Rules: `.agents/rules/web/mobile.md` · `.agents/rules/web/design-system.md` ·
  Docs: `docs/agent-guide/files.md`

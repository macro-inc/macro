# Entity appearance

## What it is

Shared icon and tag-palette color editing for routines, ordinary Markdown,
snippets, task projects (initiatives), forms, databases, and saved views.

## Start here

- `entity-appearance.tsx`: lazy editor launcher and header-only trigger, which draws the entity's type icon or the icon its host passes (a routine passes the icon its page shows).
- `appearance-menu.tsx`: device entry for desktop `views/appearance-menu.tsx` and touch `views/mobile/appearance-menu.tsx`.
- `core/appearance.ts`: eligibility and appearance comparisons.
- `components/appearance-glyph.tsx`: presentation without data fetching.
- `types.ts`: appearance targets, including saved definitions without adding them to the Soup entity union.
- `primitives/create-appearance-editor.ts`: immediate picks with guarded async settlement.
- `primitives/create-recent-icons.ts`: account-scoped recent picks through `makePersistedState` and schema-validated storage.
- `core/catalog.ts`: picker projections of `@macro-inc/entity-icons`; curate names and nouns in `packages/entity-icons/sections.json`.
- `core/picker-grid.ts`: row projection and keyboard traversal independent of the virtual viewport.
- `queries/appearance.ts`: domain writes and cache reconciliation.
- `queries/save-entity-appearance.ts`: writes document and initiative appearance through the shared Soup GraphQL mutation and routes the other editable kinds to their owning services.
- `queries/appearance-readers.ts`: typed legacy reader cancellation keys, patches, and rollbacks.
- `queries/pending-appearance.ts`: transient mutation intent for live GraphQL readers, including uncached lists.
- `appearance-dialog.tsx`: lazy editor composition with production clients for the mutation adapter.
- `queries/document-appearance.ts`: authenticated lightweight identity projection for open Markdown headers.

## Scope

- Owns: the reusable picker, immediate editing state, and entity appearance orchestration.
- Not here: category/navigation icons, task statuses, uploads, or new history views.

## Recipes

- Follow `docs/design/entity-appearance.md#icon-catalog-maintenance` for source paths, adding an icon, generated outputs, deployment order, and required checks.
- Read `tooling/icons/AGENTS.md` before changing the generator or catalog metadata.
- When the appearance wire schema changes, regenerate service and AI-tool contracts with `bun run gen-api` from `apps/web`; never hand-write appearance DTOs.

## Checks

- Run `bun run check` and `bun run test src/features/entity-appearance` from `apps/web`.
- Verify Soup row normalization and offline replay with `bunx playwright test --config src/lib/graphql-cache/worker/browser-test/appearance-write.playwright.config.ts --project chromium`.
- For catalog changes, also run the generator and backend checks in the maintenance guide.

## Gotchas

- Gate every editor entry point with `enableEntityAppearance` (`enable-entity-appearance`); dev defaults on and `VITE_ENABLE_ENTITY_APPEARANCE` overrides locally.
- When the flag is off, close open pickers but retain saved appearance rendering and API/SDK access; keep authorization independent.
- Do not change content recency or send notifications when appearance changes.
- Apply each icon, emoji, color, or Remove pick immediately without closing the editor; dismissal never undoes a pick.
- Keep mutations account-scoped, update every reader optimistically, and roll back rejected writes without overwriting newer edits.
- Filter restored and newly recorded recent picks against the current picker set; retired and unknown names are never offered, while stored retired icons and aliases still render.
- Preserve independent appearance overrides on unknown wire values: unknown colors fall back to type color, and unknown icon kinds retain their valid color.
- Show colors only on Icons; Default uses the entity type color and Remove clears only the icon.
- Keep the compact shared-visibility footer on both tabs; label editing actions “Change icon” without an ellipsis and with the shared appearance icon.
- Embed the existing picker in desktop Change icon submenus; keep header popovers and mobile sheets, with picker keyboard events scoped to the submenu.
- Match lazy-loaded submenu content with a picker-shaped skeleton, not the branded logo loader.
- Reuse the shared 12-color tag palette in `@core/constant/color-palette`; preserve named wire keys and let swatches wrap.
- Use `virtua` for both catalogs and search results; pin and restore focused choices across scrolling and Recent reordering.
- Apply document and initiative appearance through `setEntityAppearance`. Its optimistic patch and authoritative Soup row share the normalized cache identity, including on offline replay.
- For saved-view cache writes, capture the generation before reading the normalized record and retain it through optimistic, confirmed, and rollback patches.
- Keep pending appearance visible through uncached GraphQL revalidation; retain confirmed intent only for failed readers until fresh data or mutation garbage collection.
- Serialize submissions per entity and fence confirmed saved-view REST writes against older GraphQL responses. The durable queue owns uncommitted Soup appearance after enqueue.
- Render public metadata without mounting authenticated preview queries.
- Preserve appearance in identity projections and renderers, including inbox cards, project list, sidebar, and picker rows; reserve type-only icons for navigation and status.
- Keep editable header icons outside breadcrumb navigation buttons; keep read-only and flag-disabled icons inside those buttons so icon clicks still navigate. Project breadcrumbs use the lightweight identity read, including owner metadata, without loading task counts or membership.
- Keep header icon buttons at 24px with 16px glyphs; retain the shared larger touch targets.
- Pass document identity through the `MarkdownDocument` context's `entity` accessor from each host; do not read legacy block metadata inside `Notebook`.
- Keep initiative list queries limited to server-backed initiative fields; unrelated cache-only Mail fields prevent cache hits and optimistic icon updates.
- Preserve saved-view bookmark defaults and use the owner-only saved-view API; keep filter revisions/timestamps unchanged and patch the normalized definition, not Soup or previews.

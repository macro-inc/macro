# Entity appearance

## What it is

Shared icon and theme-aware color editing for routines, ordinary Markdown,
snippets, task projects (initiatives), forms, and databases.

## Start here

- `entity-appearance.tsx`: lazy editor launcher and header-only trigger.
- `core/appearance.ts`: eligibility and appearance comparisons.
- `components/appearance-glyph.tsx`: presentation without data fetching.
- `primitives/create-appearance-editor.ts`: immediate picks with guarded async settlement.
- `primitives/create-recent-icons.ts`: account-scoped recent picks.
- `core/catalog.ts`: picker-only catalog groups and exclusions.
- `queries/appearance.ts`: domain writes and cache reconciliation.
- `queries/pending-appearance.ts`: transient mutation intent for live GraphQL readers, including uncached lists.
- `save-entity-appearance.ts`: lazy production clients for the mutation adapter.
- `queries/document-appearance.ts`: authenticated lightweight identity projection for open Markdown headers.

## Scope

- Owns: the reusable picker, immediate editing state, and entity appearance orchestration.
- Not here: category/navigation icons, task statuses, uploads, or new history views.

## Recipes

- Regenerate selectable icons with `bun tooling/icons/generate-entity-icons.ts`
  from the repository root.
- Generate wire types from Rust; never hand-write appearance DTOs.

## Checks

- Run the focused editor, picker, appearance query, and imperative dialog tests; run the browser fixture only when browser testing is permitted.

## Gotchas

- Do not change content recency or send notifications when appearance changes.
- Apply each icon, emoji, color, or Remove pick immediately without closing the editor; dismissal never undoes a pick.
- Keep mutations account-scoped, update every reader optimistically, and roll back rejected writes without overwriting newer edits.
- Keep recent picks account-scoped and filter only the picker catalog; stored icon names remain valid.
- Show colors only on Icons; Default uses the entity type color and Remove clears only the icon.
- Read only the normalized appearance fields before optimistic writes; unrelated preview fields can be absent on a loaded entity.
- Type cache-write payloads with the generated subscription result; `soupUpdates` is a list.
- Keep pending appearance visible through uncached GraphQL revalidation; retain confirmed intent only for failed readers until fresh data or mutation garbage collection.
- Serialize server writes per entity, fence confirmed REST writes against older GraphQL responses, and republish confirmed appearance before releasing pending intent.
- Render public metadata without mounting authenticated preview queries.
- Preserve appearance in identity projections and renderers, including project list, sidebar, and picker rows; reserve type-only icons for navigation and status.
- Pass document title identity through `MarkdownDocument` context from each host; do not read legacy block metadata inside `Notebook`.
- Keep initiative list queries limited to server-backed initiative fields; unrelated cache-only Mail fields prevent cache hits and optimistic icon updates.

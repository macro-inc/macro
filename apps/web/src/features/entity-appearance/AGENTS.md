# Entity appearance

## What it is

Shared icon and theme-aware color editing for routines, ordinary Markdown,
snippets, task projects (initiatives), forms, and databases.

## Start here

- `entity-appearance.tsx`: lazy editor launcher and header-only trigger.
- `core/appearance.ts`: eligibility and appearance comparisons.
- `components/appearance-glyph.tsx`: presentation without data fetching.
- `primitives/create-appearance-draft.ts`: isolated drafts and guarded Apply.
- `queries/appearance.ts`: domain writes and cache reconciliation.
- `save-entity-appearance.ts`: lazy production clients for the mutation adapter.
- `queries/document-appearance.ts`: authenticated lightweight identity projection for open Markdown headers.

## Scope

- Owns: the reusable picker, its draft, and entity appearance orchestration.
- Not here: category/navigation icons, task statuses, uploads, or new history views.

## Recipes

- Regenerate selectable icons with `bun tooling/icons/generate-entity-icons.ts`
  from the repository root.
- Generate wire types from Rust; never hand-write appearance DTOs.

## Checks

- Run the focused `create-appearance-draft`, appearance query, and imperative dialog tests; run the browser fixture only when browser testing is permitted.

## Gotchas

- Do not change content recency or send notifications when appearance changes.
- Keep unsaved previews inside the picker.
- Keep mutations account-scoped, update every reader optimistically on Apply, and roll back rejected writes without overwriting newer edits.
- Serialize server writes per entity, and reconcile confirmed appearance after in-flight initial reads without canceling those reads.
- Render public metadata without mounting authenticated preview queries.
- Preserve appearance in identity projections and renderers; reserve type-only icons for navigation and status.

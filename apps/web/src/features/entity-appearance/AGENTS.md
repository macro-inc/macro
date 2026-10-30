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
- `queries/document-appearance.ts`: authenticated preview projection for open Markdown headers.

## Scope

- Owns: the reusable picker, its draft, and entity appearance orchestration.
- Not here: category/navigation icons, task statuses, uploads, or new history views.

## Recipes

- Regenerate selectable icons with `bun tooling/icons/generate-entity-icons.ts`
  from the repository root.
- Generate wire types from Rust; never hand-write appearance DTOs.

## Checks

- Run the focused `create-appearance-draft` tests and the appearance browser fixture.

## Gotchas

- Do not change content recency or send notifications when appearance changes.
- Keep unsaved previews inside the picker.
- Keep mutations account-scoped and update every reader after a confirmed save.
- Render public metadata without mounting authenticated preview queries.

# Entity icon catalog tooling

## What it is

Generate the shared entity icon vocabulary from approved SVGs and catalog metadata.
The outputs serve frontend rendering and backend validation, not navigation icons.

## Start here

- `generate-entity-icons.ts`: source/output path constants, validation, and generation.
- `generate-entity-icons.test.ts`: permanence, aliases, sections, and duplicate-geometry regression coverage.
- `packages/entity-icons/AGENTS.md`: artwork, permanent names, aliases, and picker sections.

## Scope

- Owns: generation and validation of the catalog in `packages/entity-icons/`.
- Not here: picker state or rendering; see `apps/web/src/features/entity-appearance/AGENTS.md`.

## Recipes

- Follow `docs/design/entity-appearance.md#icon-catalog-maintenance` for adding, redrawing, retiring, or renaming icons.
- Keep generator paths and reusable configuration in named constants at the top of `generate-entity-icons.ts`; reuse them in reads, writes, Git history lookups, and diagnostics.

## Checks

Run from the repository root:

- `bun tooling/icons/generate-entity-icons.ts --check`
- `bun test tooling/icons/generate-entity-icons.test.ts`
- `just check`
- For catalog changes, run the additional frontend and backend checks in the maintenance guide.

## Gotchas

- Keep Git history paths repository-relative; filesystem access resolves the same constants against the repository root.
- Preserve all committed names across every merge parent and both manifest locations; use a full clone for permanence checks.
- Edit source SVGs and metadata, never generated catalogs or label files.

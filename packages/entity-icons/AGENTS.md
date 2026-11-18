# Entity icons

## What it is

The framework-independent catalog of permanent entity icons, shared by frontend
renderers and the generator of the backend allowlist.

## Start here

- `svg/`: approved original SVG drawings; filenames are persisted icon names.
- `names.json`: append-only names, including aliases and retired icons.
- `aliases.json`: direct mappings from old names to existing drawings.
- `sections.json`: selectable icons, section order, and display nouns.
- `catalog.generated.ts`: package exports for names, aliases, and sections.

## Scope

- Owns: artwork and framework-independent catalog metadata.
- Not here: Solid components, picker state, styling, or entity permissions; those remain in `apps/web/src/features/entity-appearance/`.
- Generate catalogs through `tooling/icons/generate-entity-icons.ts`; never edit generated files by hand.

## Recipes

- Follow `docs/design/entity-appearance.md#icon-catalog-maintenance` for adding, redrawing, retiring, or renaming icons.
- Keep existing names and SVG bytes stable during moves; do not substitute third-party artwork.
- Read `tooling/icons/AGENTS.md` before changing generation or history validation.

## Checks

Run from the repository root:

- `bun tooling/icons/generate-entity-icons.ts --check`
- `bun test tooling/icons/generate-entity-icons.test.ts`
- For catalog changes, run the frontend, backend, and repository checks listed in the maintenance guide.

## Gotchas

- Keep retired drawings renderable but omit them and aliases from picker sections.
- Preserve history checks for both current and historical manifest locations when moving files.
- Keep package exports free of UI framework dependencies; consumers choose SVG rendering and lazy loading.

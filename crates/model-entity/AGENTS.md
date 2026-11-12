# model-entity

## What it is

Shared entity identity and presentation vocabulary, without persistence or authorization policy.

## Start here

- `src/lib.rs`: entity kinds and identity wrappers.
- `src/appearance.rs`: validated shared icon and named tag-palette values.
- `src/appearance_icons.generated.rs`: generated typed icon catalog; do not edit by hand.

## Scope

- Owns: identity types and the appearance wire contract.
- Not here: appearance storage, eligibility, authorization, or side effects; each entity domain owns those.

## Recipes

- Add SVGs only to `packages/entity-icons/svg/`, update picker names/nouns in `packages/entity-icons/sections.json`, and regenerate with `bun tooling/icons/generate-entity-icons.ts`.
- Deploy new server-allowed names before or with the web picker; the UI icon folder does not define stored names.
- Redraw under existing names, retire by removing section entries, or alias old names in `packages/entity-icons/aliases.json`; never delete permanent names without a data migration.
- Preserve the append-only `packages/entity-icons/names.json`; generation checks its full history and the former manifest location. See `docs/design/entity-appearance.md` for catalog maintenance.
- Validate emoji against the Unicode emoji lookup; never infer valid emoji from a Unicode block range.

## Checks

- `cargo test -p model-entity`.

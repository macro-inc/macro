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

- Add SVGs only to `apps/web/src/components/icon/entity/`, regenerate with `bun tooling/icons/generate-entity-icons.ts`, and add picker names/nouns to `tooling/icons/entity-icon-sections.json`.
- Deploy new server-allowed names before or with the web picker; the UI icon folder does not define stored names.
- Redraw under existing names, retire by removing section entries, or alias old names in `tooling/icons/entity-icon-aliases.json`; never delete permanent names without a data migration.
- Preserve the append-only `tooling/icons/entity-icon-names.json`; generation rejects missing names and identical geometry. See `docs/design/entity-appearance.md` for catalog maintenance.
- Validate emoji against the Unicode emoji lookup; never infer valid emoji from a Unicode block range.

## Checks

- `cargo test -p model-entity`.

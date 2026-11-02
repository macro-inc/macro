# model-entity

## What it is

Shared entity identity and presentation vocabulary, without persistence or authorization policy.

## Start here

- `src/lib.rs`: entity kinds and identity wrappers.
- `src/appearance.rs`: validated shared icon and palette values.
- `src/appearance_icons.generated.rs`: generated typed icon catalog; do not edit by hand.

## Scope

- Owns: identity types and the appearance wire contract.
- Not here: appearance storage, eligibility, authorization, or side effects; each entity domain owns those.

## Recipes

- Regenerate the distinct icon catalog with `bun tooling/icons/generate-entity-icons.ts` after changing selectable SVGs.
- Validate emoji against the Unicode emoji lookup; never infer valid emoji from a Unicode block range.

## Checks

- `cargo test -p model-entity`.

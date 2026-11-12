# soup_property

## What it is

Soup and search: `SoupProperty`, the property (definition plus value) attached
to a Soup item or search row. Split out of `soup_types` so `search_types`
needs only this type, not the whole Soup DTO crate.

## Boundaries

- Depends on: `properties_types`.
- Used by: `soup_types` (re-exports it as `soup_types::SoupProperty`),
  `search_types`.

## Checks

- `cargo check -p soup_property --all-features`

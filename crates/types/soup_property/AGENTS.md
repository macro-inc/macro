# soup_property

## What it is

Soup and search: `SoupProperty`, the property (definition plus value) attached
to a Soup item or search row. Split out of `models_soup` so `models_search`
needs only this type, not the whole Soup DTO crate.

## Boundaries

- Depends on: `models_properties`.
- Used by: `models_soup` (re-exports it as `models_soup::SoupProperty`),
  `models_search`.

## Checks

- `cargo check -p soup_property --all-features`

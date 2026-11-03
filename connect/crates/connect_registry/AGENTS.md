# Connect registry

## What it is

The typed, compile-time-embedded Macro Connect catalog. App data and optional
icons live in `connect/registry/apps/<id>/`.

## Start here

- `src/lib.rs`: app types, embedded entries, and registry validation.
- `../../docs/catalog.md`: the source format and field rules.

## Scope

- Owns: parsing and validating the vendor app catalog.
- Not here: OAuth connections or HTTP serving.

## Boundaries

- Depends on: third-party workspace dependencies, plus the generated
  `workspace-hack` dependency required by root hakari tooling.
- Used by: Connect services; Macro consumes the public client or SDK.

## Recipes

- Add an app: run the `connect-add-app` skill; embed the new `app.toml` and
  `icon.svg` in `src/embedded.rs`.

## Checks

- `cargo nextest run --all-features -p connect_registry`
- `cargo x deps --check` after `just hakari` when Cargo dependencies change.

## Gotchas

- Icons are unaltered vendor marks: Simple Icons 16.36.0 where it has the
  brand, otherwise the vendor's press kit (sources in git history).
  `NO_OFFICIAL_SVG_ICON` in `src/lib.rs` lists live apps with no official SVG
  yet; the catalog tests fail for any other live app without an icon.
- `own_app` entries may request explicit OAuth scopes; Slack's user scopes
  come from Macro's registered Slack app manifest.
- The dated conformance table in `../../docs/catalog.md` records probe URLs,
  registration outcomes, and why used entries remain pending.

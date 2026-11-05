# code_mode_assets

## What it is

Agent code mode's generated assets: the public SDK and Handlebars bundled for
Deno, the agent SDK documentation catalog, and the SDK operation labels. They are
built from `packages/sdk` when this crate compiles and are never committed.

## How it works

`build.rs` takes the assets from exactly one place:

- `CODE_MODE_ASSETS_DIR` set (Nix builds and Rust CI): that directory, built by
  the `code-mode-assets` flake package from the Nix `node_modules`.
- Unset (local cargo): it runs `packages/code-mode-sdk/scripts/generate.ts` with
  `bun` into `OUT_DIR`, rerunning when SDK, generator or lockfile sources change.

A failed run or a missing file fails the build; there is no stale fallback.

The Lexical modules are code split, so their chunk names follow their content:
`build.rs` reads `lexical-modules.tsv` and writes `lexical_modules.rs`, which
embeds each file as `LEXICAL_MODULES` with the specifier it serves.

## Scope

- Owns: building and embedding the assets.
- Not here: the generator (`packages/code-mode-sdk`), process isolation
  (`crates/code_execution`), documentation selection (`crates/agent_code_mode`).

## Checks

- `cargo build -p code_mode_assets` after `bun install --frozen-lockfile` at the
  repository root and in `packages/sdk`.
- `nix build --no-link .#code-mode-assets` after changing the generator's inputs
  or `nix/cloud-storage.nix`.

## Gotchas

- A new generator input outside `GENERATOR_INPUTS` in `build.rs` or the
  `codeModeAssetsSrc` filter in `nix/cloud-storage.nix` leaves cargo or Nix
  builds stale; add it to both.
- Compiling this crate (and every dependent, including DSS and the agent
  harness) needs bun and both `node_modules` installs unless
  `CODE_MODE_ASSETS_DIR` is set.

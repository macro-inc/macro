# Code-mode SDK bundle

## Scope

Packages the public Macro SDK and Handlebars for restricted Deno execution and
builds the agent documentation catalog. Canonical TypeDoc rendering and the
HTML worker belong to `packages/sdk-docs`.

## Start here

- `scripts/generate.ts`: builds the Deno bundles and backend documentation into
  the directory it is given; `crates/code_mode_assets` runs it at build time.
- `scripts/typedoc.ts`: index each entity and split linked Markdown into
  per-symbol references (classes, methods, types).
- `scripts/catalog.ts`: compact entity descriptions; agent and harness docs share
  a topic, as do native channels, external chats and WhatsApp, so discovery stays
  within its 32-question classifier limit.
- `src/index.ts`: public SDK exports used by programs.

## Tool contracts

- External chat sends/uploads use only the credential owner's connection and accept their session or own API token (including signed agent attribution); bots never send. Pairing and account/access controls require the person's session.
- Agent documentation excludes the legacy chats/workspace namespaces and their Macro properties; public SDK APIs remain compatible for existing callers.

## Checks

- Run root `just check` for formatting; CodeMode uses `apps/web/biome.jsonc`, while the standalone SDK has its own formatter.

- `bun run type-check` and `bun run test` (generates into ignored `dist/` first).
- `cargo test -p code_execution -- --include-ignored` runs the bundle in Deno.

Run from this directory after installing the root workspace and the standalone
`packages/sdk` dependencies with `bun install --frozen-lockfile`, as CI does;
the generator refuses to run without `packages/sdk/node_modules`.

## Gotchas

- The outputs are never committed. A new file the generator reads must be added
  to `GENERATOR_INPUTS` in `crates/code_mode_assets/build.rs` and to
  `codeModeAssetsSrc` in `nix/cloud-storage.nix`.

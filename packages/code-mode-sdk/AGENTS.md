# Code-mode SDK bundle

## Scope

Packages the public Macro SDK and Handlebars for restricted Deno execution and
builds the agent documentation catalog. Canonical TypeDoc rendering and the
HTML worker belong to `packages/sdk-docs`.

## Start here

- `scripts/generate.ts`: builds the Deno bundles and backend documentation into
  the directory it is given; `crates/code_mode_assets` runs it at build time.
- `scripts/typedoc.ts`: index each entity and split linked Markdown into
  per-symbol references (classes, methods, types). A discriminated union over
  the 16 KiB reference size, such as `EditOp`, lists its members, each read as
  `EditOp.<discriminator>`.
- `scripts/catalog.ts`: the entity directories agents discover, one entity
  each. Never fold an area into another to save room: Jev routes the catalog
  in parallel 32-question calls, so its size is not capped.
- Each entity's description is its one `@routing` sentence ("Use when …; not
  …") and its `guide` every `@agent` block, both from the SDK's TSDoc and
  collected by `packages/sdk-docs/src/render.ts`. Generation fails for an
  entity without exactly one `@routing` sentence, or a tag outside every
  entity. Agents route on the sentence; the guide is how that area works,
  inlined into unrouted prompts and loaded with the entity on routed turns.
- `src/index.ts`: public SDK exports used by programs.

## Tool contracts

- External chat sends/uploads use only the credential owner's connection and accept their session or own API token (including signed agent attribution); bots never send. Pairing and account/access controls require the person's session.

## Checks

- Run root `just check` for formatting; CodeMode uses `apps/web/biome.jsonc`, while the standalone SDK has its own formatter.

- `bun run type-check` and `bun run test` (generates into ignored `dist/` first).
- `cargo test -p code_execution_outbound -- --include-ignored` runs the bundle in Deno.

Run from this directory after installing the root workspace and the standalone
`packages/sdk` dependencies with `bun install --frozen-lockfile`, as CI does;
the generator refuses to run without `packages/sdk/node_modules`.

## Gotchas

- The outputs are never committed. A new file the generator reads must be added
  to `GENERATOR_INPUTS` in `crates/code_mode_assets/build.rs` and to
  `codeModeAssetsSrc` in `nix/cloud-storage.nix`.

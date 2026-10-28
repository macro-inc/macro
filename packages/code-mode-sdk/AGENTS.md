# Code-mode SDK bundle

## Scope

Packages the public Macro SDK and Handlebars for restricted Deno execution and
builds the agent documentation catalog. Canonical TypeDoc rendering and the
HTML worker belong to `packages/sdk-docs`.

## Start here

- `scripts/generate.ts`: bundle and backend artifact generation.
- `scripts/typedoc.ts`: collect linked Markdown documentation by entity.
- `scripts/catalog.ts`: compact entity descriptions; agent and harness docs share
  a topic so discovery stays within its 32-question classifier limit.
- `src/index.ts`: public SDK exports used by programs.

## Tool contracts

- Agent documentation excludes the legacy chats/workspace namespaces and their Macro properties; public SDK APIs remain compatible for existing callers.

## Checks

- `bun run generate`, then `bun run check:generated`.
- `bun run type-check` and `bun run test`.

Run from this directory after installing the root workspace and the standalone
`packages/sdk` dependencies. Generated Rust documentation JSON and Deno bundles
must match the public SDK; edit source and regenerate them together.
Use the repository's pinned Bun version (via `nix develop`); different Bun
bundlers produce different checked-in output even from identical SDK source.
Run SDK-docs and code-mode generated-output checks sequentially; both render into
`packages/sdk-docs/dist/docs`.

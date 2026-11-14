# SDK for OCaml

## What it is

The permission layer for SDK programs: each OpenAPI operation's group and
action, and an HTTP proxy that checks every call a program makes against a
permission endpoint. Usage is in `README.md`.

## Start here

- `spec/permissions.json`: each OpenAPI operation's group and action, by
  hand; `spec/build.ts` turns it into `spec/operations.json`.
- `proxy/`: the HTTP proxy, mock permission endpoint and fake upstream (own
  `AGENTS.md`).

## Scope

- Not here: the specs themselves (synced copies) → `packages/sdk/specs`; the
  TypeScript SDK → `packages/sdk`. Nothing here uses the TypeScript SDK.

## Recipes

- A spec sync added or removed an operation: classify it in
  `spec/permissions.json` (README, "Operation permissions"), then
  `bun spec/build.ts`. Never rerun `spec/seed.ts --force` over hand edits.

## Checks

From the repository root (deps: `bun install --frozen-lockfile` at the root):

- `nix shell nixpkgs#bun -c sh -c 'cd packages/sdk-ocaml && bun spec/build.ts && bun test spec'`
  after a spec sync or a change under `spec/`.
- `bun run test` and `bun run type-check` in `proxy/` after a change there.
- Spec TypeScript: `bun ../../node_modules/typescript/bin/tsc --noEmit -p spec/tsconfig.json`.

## Gotchas

- Operation names use the spec's operationId verbatim (snake_case), and
  are unique only after `spec/renames.json`; every tool that reads the
  specs goes through `spec/specs.ts` or reads `spec/operations.json`.
- Of a program's headers, the proxy forwards only a fixed allow-list and the
  header parameters the matched operation declares (`headers` in
  `spec/operations.json`).

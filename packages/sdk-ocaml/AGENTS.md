# SDK for OCaml

## What it is

A prototype of permissioned SDK code: programs written in OCaml against
`macro_sdk`, a typed client generated from the OpenAPI specs,  run through a proxy
that checks every call. Usage and the OCaml surface are in `README.md`.

## Start here

- `spec/permissions.json`: each OpenAPI operation's group and action, by
  hand; `spec/build.ts` turns it into `spec/operations.json`.
- `generator/emit.ts`: OpenAPI schemas and operations to OCaml types, codecs
  and functions, one service at a time.
- `lib/macro_runtime.ml`: the client's HTTP transport and codec helpers.
- `proxy/`: the HTTP proxy, mock permission endpoint and fake upstream (own
  `AGENTS.md`).

## Scope

- Not here: the specs themselves (synced copies) → `packages/sdk/specs`; the
  TypeScript SDK → `packages/sdk`. Nothing here uses the TypeScript SDK.

## Recipes

- A spec sync added or removed an operation: classify it in
  `spec/permissions.json` (README, "Operation permissions"), then
  `bun spec/build.ts`. Never rerun `spec/seed.ts --force` over hand edits.
- A spec changed: regenerate (`bun generator/generate.ts`); in `lib/` only
  `macro_runtime.ml`, `macro_json.ml` and `macro_error.ml` are written by
  hand. The generator throws on a schema feature it doesn't handle: extend
  `lowerUncached`/`union` rather than skipping the operation.
- Change how a schema maps to OCaml: `lower`, `enc`, `dec`, `sample` and
  `schemaSample` in `generator/emit.ts` move together.

## Checks

From the repository root (deps: `bun install --frozen-lockfile` at the root):

- `nix-shell packages/sdk-ocaml/shell.nix --run 'cd packages/sdk-ocaml && bun generator/generate.ts && dune build @install && dune test && bun test generator spec'`
- `nix shell nixpkgs#bun -c sh -c 'cd packages/sdk-ocaml && bun spec/build.ts && bun test spec'`
  after a spec sync or a change under `spec/`.
- `bun run test` and `bun run type-check` in `proxy/` after a change there.
- Generator TypeScript: `bun ../../node_modules/typescript/bin/tsc --noEmit -p generator/tsconfig.json`;
  the same with `spec/tsconfig.json` for `spec/`.

## Gotchas

- Operation names use the spec's operationId verbatim (snake_case), and
  are unique only after `spec/renames.json`; every tool that reads the
  specs goes through `spec/specs.ts` or reads `spec/operations.json`.
- `lib/macro*.ml(i)` (except the three hand-written files),
  `lib/operations.json` and the `test/all_operations*` fixtures are
  generated and gitignored; `dune build` fails until the generator has run.
- Every value in `macro.mli` needs `[@@macro.op]` or `[@@macro.pure]`
  (`check_interface` fails otherwise); no pure value may make a call or
  return a closure or object that makes calls.
- `macro.mli` copies each service with `module X : module type of Macro_x`,
  which `check_interface` sees as a literal signature; a module alias there
  would hide the service's values from it.
- The proxy refuses encoded `/`, `\`, `%`, control and unreserved
  characters, dot segments and a body on GET; the runtime percent-encodes
  only non-unreserved bytes and rejects path values it can't send. Of the
  program's headers, the proxy forwards only the fixed allow-list and the
  header parameters the matched operation declares (`headers` in
  `spec/operations.json`).
- The transport must stop reading at Content-Length: Bun keeps connections
  open, and a read to end of file hangs.
- Records in one recursive type group can't share a label (warning 30 is an
  error), so the generator suffixes a later one (`clauses_2`). Never disable
  warnings to get generated code through.

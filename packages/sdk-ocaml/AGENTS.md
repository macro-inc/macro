# sdk-ocaml

## What it is

The OCaml client for the Macro API: `macro_sdk` (types, codecs and sans-IO
request builders for every operation in `../sdk/specs`) and `macro_sdk_eio`
(the cohttp-eio transport). The OCaml counterpart of `../sdk/generated`.

## How it works

`gen/` lowers each OpenAPI 3.1 spec to an IR (`ir.ml`), emits a Parsetree
(ppxlib `Ast_builder` + metaquot), prints it with `Pprintast` and formats it
with ocamlformat into `generated/`. Operations return a
`Macro_sdk_runtime.Request.t`; a transport `prepare`s it (host, auth,
encoding) and hands the reply to `interpret`.

## Start here

- `gen/lower_schema.ml`: how each schema shape becomes an OCaml type.
- `gen/lower_ops.ml`, `gen/emit_ops.ml`: operations, replies, error bodies.
- `runtime/request.ml`, `runtime/config.ml`: the request type, hosts, auth.

## Scope

- Owns: the generator, the runtime, the Eio transport, `generated/`.
- Not here: the specs (`../sdk/specs`, synced by `../sdk`); hand-written
  entity APIs like the TypeScript SDK's `src/` (none yet).

## Recipes

- Specs changed: `just generate`, then commit `generated/`.
- New schema shape the generator rejects: handle it in `gen/lower_schema.ml`,
  emit it in `gen/emit_types.ml`, add it to `test/fixtures/kinds.json` and
  `test/test_kinds.ml`.
- New service: add its hosts to `runtime/config.ml` (`test_config` compares
  them with `../sdk/src/config.ts`).

## Checks

- `nix-shell shell.nix --run "dune build && dune test"` (from this directory).
  CI runs the same as `OCaml SDK Check` (`tooling/xtask/crates/xtask_workflows/src/workflows/sdk_ocaml_check.rs`).
- `dune fmt` for hand-written code.

## Gotchas

- Never edit `generated/`; the `drift` test regenerates it and diffs.
- Generated code must not use string templates or regexes: build Parsetree
  nodes. Docs travel as `ocaml.doc` attributes; `gen/print.ml` turns them
  into `(** *)` comments.
- Tests read `../sdk/specs` and `../sdk/src/config.ts` through
  `DUNE_SOURCEROOT`, outside this dune project, so those rules always rerun.
- The host table is hand-copied: `.agents/rules/config-and-service-urls.md`.

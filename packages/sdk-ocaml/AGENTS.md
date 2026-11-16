# sdk-ocaml

## What it is

The OCaml client for the Macro API: `macro_sdk` (types, codecs and sans-IO
request builders for every operation in `../sdk/specs`) and `macro_sdk_eio`
(the cohttp-eio transport). The OCaml counterpart of `../sdk/generated`.
Also `analyzer/`: a static analysis tool that lists the operations a
compiled program may call (`macro_sdk_calls`), not wired into anything yet.

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
- `analyzer/lib/analyze.ml`: the call analysis over a program's `.cmt`;
  `analyzer/index/index.ml` builds its operation table from `generated/`.

## Scope

- Owns: the generator, the runtime, the Eio transport, `generated/`, the
  call analyzer.
- Not here: the specs (`../sdk/specs`, synced by `../sdk`); hand-written
  entity APIs like the TypeScript SDK's `src/` (none yet).

## Recipes

- Specs changed: `just generate`, then commit `generated/`.
- New schema shape the generator rejects: handle it in `gen/lower_schema.ml`,
  emit it in `gen/emit_types.ml`, add it to `test/fixtures/kinds.json` and
  `test/test_kinds.ml`.
- New service: add its hosts to `runtime/config.ml` (`test_config` compares
  them with `../sdk/src/config.ts`).
- New way for a program to reach an operation without naming it (an SDK
  value that returns requests, a new escape hatch): handle it in
  `analyzer/lib/analyze.ml` and add a program to `analyzer/test/corpus/`
  whose first line states the expected answer.

## Checks

- `nix-shell shell.nix --run "dune build && dune test"` (from this directory).
  CI runs the same as `OCaml SDK Check` (`tooling/xtask/crates/xtask_workflows/src/workflows/sdk_ocaml_check.rs`).
- `dune fmt` for hand-written code.

## Gotchas

- Never edit `generated/`; the `drift` test regenerates it and diffs.
- The analyzer's soundness rests on `analyzer/test/test_coverage.ml`: an SDK
  value that can return a `Request.t` but is not an operation in the table
  fails it. Fix the analyzer, never the test.
- Corpus programs state expected line numbers; `dune fmt` can move lines,
  so rerun `dune test` after formatting them.
- Generated code must not use string templates or regexes: build Parsetree
  nodes. Docs travel as `ocaml.doc` attributes; `gen/print.ml` turns them
  into `(** *)` comments.
- Tests read `../sdk/specs` and `../sdk/src/config.ts` through
  `DUNE_SOURCEROOT`, outside this dune project, so those rules always rerun.
- The host table is hand-copied: `.agents/rules/config-and-service-urls.md`.

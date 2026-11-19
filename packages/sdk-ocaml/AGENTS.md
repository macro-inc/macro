# sdk-ocaml

## What it is

The OCaml client for the Macro API: `macro_sdk` (types, codecs and sans-IO
request builders for every operation in `../sdk/specs`), `macro_sdk_eio`
(the cohttp-eio transport), `macro_sdk_fetch` (`fetch/`, the
WebAssembly transport over JavaScript's `fetch`, for code mode) and
`code_mode` (`code_mode/`, the code-mode program contract and the prebuilt
Wasm bundle programs compile against). The OCaml counterpart of
`../sdk/generated`. Also `analyzer/`: a static analysis tool that lists the
operations a compiled program may call (`macro_sdk_calls`), code-mode
programs included; not wired into anything yet.

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
- `fetch/macro_sdk_fetch.mli`: the Wasm transport and its contract with the
  `fetch` it calls.
- `code_mode/code_mode.mli`: the program contract and the bootstrap's side.
- `code_mode/bundle/build.sh`, `compile.sh`: code mode's bundle and the
  per-program compile (README "Code mode bundle").
- `analyzer/lib/analyze.ml`: the call analysis over a program's `.cmt`;
  `analyzer/index/index.ml` builds its operation table from `generated/`.

## Scope

- Owns: the generator, the runtime, the Eio and fetch transports,
  `code_mode`, the code-mode bundle's build (`code_mode/bundle/`; the nix
  derivation is `codeModeOcaml` in `nix/cloud-storage.nix`), code mode's
  policy check (`code_mode/policy/`, a native tool the bundle ships),
  `generated/`, the call analyzer.
- Not here: the specs (`../sdk/specs`, synced by `../sdk`); hand-written
  entity APIs like the TypeScript SDK's `src/` (none yet); code mode's
  OCaml compile step and bootstrap (`crates/code_execution`).

## Recipes

- Specs changed: `just generate`, then commit `generated/`. A new
  operation also needs a line in
  `../../crates/agent_permission_registry/registry.json` (its group, action
  and label; that crate's `AGENTS.md`); `test_registry` fails until it has
  one, and on a line for an operation that is gone.
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
- `fetch/` or `code_mode/` changed: `nix-shell shell.nix --run "dune build
  --profile wasm --build-dir _build_wasm @fetch/runtest @code_mode/runtest"`
  (Deno tests; CI runs it after the native checks).
- The bundle or anything it builds changed: `nix build --no-link -L
  .#checks.x86_64-linux.code-mode-ocaml-sample` from the repository root
  (CI runs it too); it prints compile time and startup. New files must be
  `git add`ed first: the flake sees only tracked files.
- `dune fmt` for hand-written code.

## Gotchas

- Never edit `generated/`; the `drift` test regenerates it and diffs.
- The analyzer's soundness rests on `analyzer/test/test_coverage.ml`: an SDK
  value that can return a `Request.t` but is not an operation in the table
  fails it. Fix the analyzer, never the test.
- The analyzer trusts `fetch/` and `code_mode/` (`Analyze.default_libraries`)
  without analyzing them; `analyzer/test/test_trusted.ml` fails if either
  names `Macro_sdk` or builds or rewrites a request. Keep them that way: an operation they
  sent themselves would be invisible to agent permissions. Never trust
  `Js_of_ocaml`. Their interfaces reach the corpus through copies
  (`analyzer/test/code_mode_interfaces`), which follow the `.mli` files.
- Corpus programs state expected line numbers; `dune fmt` can move lines,
  so rerun `dune test` after formatting them.
- Generated code must not use string templates or regexes: build Parsetree
  nodes. Docs travel as `ocaml.doc` attributes; `gen/print.ml` turns them
  into `(** *)` comments.
- Tests read `../sdk/specs` and `../sdk/src/config.ts` through
  `DUNE_SOURCEROOT`, outside this dune project, so those rules always rerun.
- `fetch/` and `code_mode/` build only in the `wasm` profile
  (`enabled_if`); never make native `dune build` depend on js_of_ocaml or
  wasm_of_ocaml.
- `globalThis.__macroCodeMode` (`code_mode.mli`) is the contract with code
  mode's bootstrap; `code_mode/test/run.mjs` plays that side. Change them
  together.
- The bundle's runtime additions (`fetch/*.wat`, `fetch/await.js`) are
  listed again in `code_mode/bundle/build.sh`; a new one goes in both.
- A new library a program may use: its `.cmi` files in `build.sh`'s `cmi/`
  copy and its archive in the link order. Never put js_of_ocaml's `.cmi`
  files there: programs must not name the JavaScript interop.
- `macroSdkOperation` on the `fetch` init is the contract with code mode's
  bootstrap (`crates/code_execution/src/outbound/deno/bootstrap.mjs`, which
  reads it); change both together. `fetch/test/` checks `sdk_method` against
  `../sdk/generated/*/sdk.gen.ts`.
- The host table is hand-copied: `.agents/rules/config-and-service-urls.md`.

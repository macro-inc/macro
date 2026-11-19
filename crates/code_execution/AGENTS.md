# Code execution

## Scope

Runs a bounded JavaScript program, an OCaml program compiled to
WebAssembly first, or a JS tools program in `@opencode/codemode`'s
interpreter, in a fresh Deno process inside the calling service.
Session authentication, token issuance and execution storage belong to
`crates/agent_code_mode` and its composition root.

## Start here

- `README.md`: permissions, limits and the program contract.
- `src/domain/service.rs`: admission and cancellation.
- `src/outbound/deno.rs`: process lifecycle and restricted permissions.
- `src/outbound/deno/bootstrap.mjs`: program loading, unattended dry runs
  and final JSON protocol.
- `src/outbound/deno/check.rs`: type-checking TypeScript against the SDK.
- `src/outbound/ocaml.rs`: the OCaml bundle and the compile step;
  `src/outbound/ocaml/check.rs`: type-checking OCaml;
  `src/outbound/ocaml/analyze.rs`: `OcamlAnalyzer`, the `ProgramAnalyzer`
  that lists the SDK calls (`SdkCall`: service, raw operationId, method,
  route) a program may call, with the bundle's `macro_sdk_calls`, for the
  agent permissions gate.
- `src/domain/operations.rs`: the generated operation catalog (labels, routes,
  read or write) and the SDK fingerprint.
- JS tools programs: `runJsTools` and `callTool` in `bootstrap.mjs`;
  `src/outbound/deno/js_tools_analyze.mjs`, the analyzer as a process for the
  permission gate (interface in its header); tests in
  `src/outbound/deno/test/js_tools.rs`.

## Gotchas

The bundled public SDK makes ordinary HTTP requests. There is no tool-name
proxy or host-call bridge. Cancellation stops the process; it does not roll back
completed API writes. SDK and Handlebars bundles, the operation catalog and
the SDK's type declarations come from `crates/code_mode_assets`, generated from
the public SDK at build time by `packages/code-mode-sdk`. A POST that only reads
must be listed in the generator's `postReads`, or dry runs skip it.
The SDK adds `x-macro-sdk-verb` to each generated call from the hand-assigned
registry; the header is attached to that call's options before request dispatch.

Authenticated SDK requests carry `x-macro-code-execution: 1`, the only mark a
run under a plain user token (public MCP) has. APIs that ask a program to
confirm what a person picks by opening something read it; the calendar
mutation routes demand the copy's `inbox` from such requests, the calendar
create route refuses them, and the email send and schedule routes refuse
them unless the schedule quotes the user's approval
(`macro_authorization::is_agent_run`).

`RunEnvironment::endpoints` carries the SDK's hosts and the web app origin; the
host fills both from `macro_service_urls`. Leaving `webAppUrl` out of
`new Macro(...)` makes the SDK default to prod, so `webUrl()` links on dev and
local would point at macro.com.

The bootstrap bans timers before importing `main.mjs`, and the import map points
node timer and worker modules at `timers.mjs`. The bundled SDK's only timer is
the SSE reconnect delay, so a reconnecting event stream fails the same way.

The bootstrap replaces a result's `data` larger than `Limits::max_result_bytes`
with an outline and preview, keeping `reviews`; the frame limit stays the backstop.
An unattended result is never summarized: later routine steps read it whole, so
one over the limit fails the run with a message saying so.

OCaml programs compile against the bundle `code_mode_assets::OCAML_BUNDLE`
names (`CODE_MODE_OCAML_DIR` at build time, `nix build .#code-mode-ocaml`);
without one they fail saying so. The bootstrap evaluates wasm_of_ocaml's
loader by splitting it after its first statement (`(Object));`), so a
wasm_of_ocaml upgrade that changes the loader's shape fails every OCaml test
with "unexpected wasm_of_ocaml loader shape". `RunEnvironment::allowed_operations`
(set by the permission gate, OCaml and JS tools only; a JavaScript run carrying
it fails) makes the bootstrap refuse any OCaml or JS tools request whose `macroSdkOperation`
service, raw `operationId`, method, host and route don't match one of them,
or whose path a more specific rival route also matches (a parameter equal to a
sibling's literal segment, `/documents/{}` reaching `/documents/system_skills`;
the analyzer lists each call's `rivals`, from the SDK's routes only: a
route a service serves outside its OpenAPI spec is not one), reporting it as
`refused` activity; `None` sends everything as before. The policy check
(`packages/sdk-ocaml/code_mode/policy`) is defense in depth: keep the Deno
flags the boundary for OCaml as for JavaScript.

A JS tools run analyzes `main.js` again with the same `js-tools.mjs` the gate
used and refuses one that may call outside `allowed_operations` before it
starts; the interpreter's `tool.before` hook admits only what the analysis
found. Its Deno flags are a JavaScript run's, exactly
(`js_tools_runs_get_exactly_a_javascript_runs_deno_flags`): keep them so.
The bootstrap bans timers for JavaScript but gives them back to a JS tools
run, whose interpreter (Effect) schedules with them; the program has none.
`callTool` calls the generated SDK method from the client's prototype, not
the SDK's observed wrapper (which demands a display verb that unwrapped
operations lack), so `fetch` reports it like an OCaml request.

## Checks

- `cargo test -p code_execution --lib -- --include-ignored` from the repository
  root with Deno available; real-process tests exercise permissions and cleanup.
  The OCaml tests (`src/outbound/deno/test/ocaml.rs`) also need the bundle:
  `CODE_MODE_OCAML_DIR=$(nix build --no-link --print-out-paths .#code-mode-ocaml)`
  set for the build. Every isolation test of the JavaScript path has an OCaml
  twin there and a JS tools twin in `src/outbound/deno/test/js_tools.rs`, or
  is listed as not applying in that file's header; add one with each new
  one.

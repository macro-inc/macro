# Program execution

## Scope

Type-checks a bounded TypeScript program against the SDK, then runs it, or
runs a JS tools program in `@opencode/codemode`'s interpreter, in a fresh
Deno process inside the calling service. Session authentication, token
issuance and execution storage belong to `crates/agent_code_mode` and its
composition root.

## Start here

- `README.md`: permissions, limits and the program contract.
- `src/domain/service.rs`: admission, the type check before a run, and
  cancellation.
- `src/domain/context.rs`: `CodeContext`, the type of an attended `main`'s
  argument.
- `src/outbound/deno.rs`: process lifecycle, restricted permissions and the
  import map (`NODE_ALLOWED`, `NODE_BUILTINS`; blocked built-ins resolve to
  `deno/unavailable.mjs`).
- `src/outbound/deno/bootstrap.mjs`: program loading, unattended dry runs
  (a routine's entity knobs, marked `$entity`, reach `main` as SDK handles),
  removing every way to the network but `fetch`, and final JSON protocol.
  Before building the program's client it installs the process's SDK
  policies: the per-operation call budget, diagnostics, and a search limit
  (`limitSearches`, `SEARCHES_IN_FLIGHT` = 4), so every client the program
  builds sends at most four searches at once and the rest wait in call order:
  the search cluster's few threads queue every user's search behind a
  program's burst, while one at a time pushes programs with dozens of searches
  past their deadline.
- `src/outbound/deno/check.rs`: type-checking TypeScript against the SDK.
- `src/domain/operations.rs`: the generated operation catalog (labels, routes,
  read or write) and the SDK fingerprint.
- JS tools programs: `runJsTools` and `callTool` in `bootstrap.mjs`;
  `src/outbound/deno/js_tools_analyze.mjs`, the analyzer as a process for the
  permission gate (interface in its header), run by `JsToolsAnalyzer`
  (`src/outbound/deno/analyze.rs`); tests in
  `src/outbound/deno/test/js_tools.rs` and `src/outbound/deno/analyze/test.rs`.
- `src/outbound/analysis.rs`: the analyzers' shared JSON answer
  (`macro_sdk_calls --json`'s shape plus `diagnostics`).

## Gotchas

The bundled public SDK makes ordinary HTTP requests. There is no tool-name
proxy or host-call bridge. Cancellation stops the process; it does not roll back
completed API writes. SDK and Handlebars bundles, the operation catalog and
the SDK's type declarations come from `crates/code_mode_assets`, generated from
the public SDK at build time by `packages/code-mode-sdk`. A POST that only reads
must be listed in the generator's `postReads`, or dry runs skip it.
The SDK adds `x-macro-sdk-verb` to each generated call from the hand-assigned
registry; the header is attached to that call's options before request dispatch.

Every request to an SDK origin carries `x-macro-code-execution`, whatever
credential it carries: `1`, or `js_tools` from a JavaScript tools program
(`egress::code_execution_marker`, set by the bootstrap and, in a proxied run,
by the forwarder), so a refusal can name the dialect's operations. A program
can drop it with a raw `fetch`, so a refusal that must hold reads the credential's signed claims too: every code-mode
credential, public MCP's included, signs an agent or a routine
(`macro_authorization::is_program_run`), and the header never overrides a
signed claim. The calendar mutation routes demand the copy's `inbox` from
every program run; the calendar create route and the email send and schedule
routes refuse agent runs (`macro_authorization::is_agent_run`) unless the send
quotes the user's approval, so an owner routine step (signed `routine_id`, no
agent) sends and creates. The email sign-in and the MCP OAuth broker take no
credential, so the header is what refuses a program there.

A program reads Macro's own sign-in emails redacted (email and storage-service responses, `models_email::sign_in_email`), and GraphQL refuses it.

A run whose `RunEnvironment::egress` is `Egress::Proxied` reaches the hosts
only through a loopback forwarder the runner starts for it
(`src/outbound/deno/egress.rs`): `--allow-net` names only that listener.
The child keeps the real hosts, which the links it builds need, and its
fetch sends a request to a host's base to that service under the forwarder
(`forwarder` in the child's context, `http://127.0.0.1:<port>/<service>`).
The forwarder sets the mark and trace context itself, outside the realm, drops
the ones the program set, follows no redirects and records a
`code_execution.egress` span per request. It stops when the run ends, is
cancelled or times out. The agent harness picks it per user with the
fail-closed `enable-code-execution-egress-proxy` flag; `Egress::Direct` (the
default) is the old path.

`RunEnvironment::endpoints` carries the SDK's hosts and the web app origin; the
host fills both from `macro_service_urls`. Leaving `webAppUrl` out of
`new Macro(...)` makes the SDK default to prod, so `webUrl()` links on dev and
local would point at macro.com.

`ExecutionService` checks every attended program before it takes a process
slot; one with type errors fails with `FailureCode::Compile` and the checker's
messages, and a busy or failed checker fails the run rather than running it
unchecked. Unattended (routine) programs are checked by their host as a whole
routine when saved, so their runs aren't checked again. Hosts call
`ProgramExecutor::check_program` before doing anything for a run (owner
approval, credentials), so a type error stops it there; that pass covers the
next run of the same source and `ContextShape`, which skips its own check
(`check = prechecked`).

The bootstrap bans timers before importing `main.ts`, and the import map points
node timer modules (and, in attended runs, worker modules) at `timers.mjs`; every
other built-in outside `NODE_ALLOWED` goes to `unavailable.mjs`. Bumping
`DENO_VERSION` means running `every_node_builtin_but_the_allowed_ones_is_unavailable`
and adding any new built-in to `NODE_BUILTINS`. The bundled SDK's only timer is
the SSE reconnect delay, so a reconnecting event stream fails the same way.
Keep both timer errors explicit about unsupported deadline guards, the host's
execution deadline, and bounded `Promise.allSettled` batches for partial results;
`Promise.allSettled` itself does not impose a timeout.

The bootstrap replaces a result's `data` larger than `Limits::max_result_bytes`
with an outline and preview, keeping `reviews`; the frame limit stays the backstop.
An unattended result is never summarized: later routine steps read it whole, so
one over the limit fails the run with a message saying so.

Every Deno child's `code_execution.process` span records how it ended:
`process.exit_code` or `process.signal`, `process.wall_ms`, `process.cpu_ms`
and `process.peak_rss_kib` (`outbound/deno/exit.rs`). Peak memory is `VmHWM`
sampled from procfs every 250 ms while the child runs, since it is gone
before the child's pipes close (a child that dies within one interval
shows only its startup peak); CPU time is read once more after they close.
A run the deadline, a cancellation or a protocol error cuts short records
the same fields with `process.killed = true` (its status is the runner's
kill). A child that ends on its own without exit code 0 after its terminal
frame logs one `Deno child ended abnormally` warning with the same fields.

`RunEnvironment::allowed_operations` (set by the permission gate, JS tools
only; a JavaScript run carrying it fails) makes the bootstrap refuse any JS
tools request whose `macroSdkOperation` service, raw `operationId`, method,
host and route don't match one of them, or whose path a more specific rival
route also matches (a parameter equal to a sibling's literal segment,
`/documents/{}` reaching `/documents/system_skills`; the analyzer lists each
call's `rivals`, from the SDK's routes only: a route a service serves outside
its OpenAPI spec is not one), reporting it as `refused` activity. A JS tools
run without it never starts (`DenoRunner` refuses it, and the bootstrap
again).

A JS tools run analyzes `main.js` again with the same `js-tools.mjs` the gate
used and refuses one that may call outside `allowed_operations` before it
starts; the interpreter's `tool.before` hook admits only what the analysis
found. Its Deno flags are a JavaScript run's, exactly
(`js_tools_runs_get_exactly_a_javascript_runs_deno_flags`): keep them so.
The bootstrap bans timers for JavaScript but gives them back to a JS tools
run, whose interpreter (Effect) schedules with them; the program has none.
`callTool` calls the generated SDK method from the client's prototype, not
the SDK's observed wrapper (which demands a display verb that unwrapped
operations lack), so `fetch` reports and gates it as a named request.

## Checks

- `cargo test -p code_execution --lib -- --include-ignored` from the repository
  root with Deno available; real-process tests exercise permissions and cleanup.
  Every isolation test of the JavaScript path has a JS tools twin in
  `src/outbound/deno/test/js_tools.rs`, or is listed as not applying in that
  file's header; add one with each new one.

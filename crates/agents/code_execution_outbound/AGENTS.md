# JavaScript execution: Deno runner

## Scope

Runs a bounded JavaScript program in a fresh Deno process inside the calling
service. It implements the `CodeRunner` and `ProgramChecker` ports of
`crates/agents/code_execution_core`, which owns admission, cancellation and the
protocol types. Session authentication, token issuance and execution storage
belong to `crates/agent_code_mode` and its composition root.

## Start here

- `README.md`: permissions, limits and the program contract.
- `src/deno.rs`: process lifecycle, restricted permissions and the import map
  (`NODE_ALLOWED`, `NODE_BUILTINS`; blocked built-ins resolve to
  `deno/unavailable.mjs`).
- `src/deno/bootstrap.mjs`: program loading, unattended dry runs
  (a routine's entity knobs, marked `$entity`, reach `main` as SDK handles),
  removing every way to the network but `fetch`, and final JSON protocol.
- `src/deno/check.rs`: type-checking TypeScript against the SDK.
- `../code_execution_core/src/operations.rs`: the generated operation catalog (labels, routes,
  read or write) and the SDK fingerprint.

## Boundaries

- Depends on: `code_execution_core` (ports and models), `code_mode_assets`.
- Used by: the composition root in `services/agent_harness_service` only.
  Everything else depends on `code_execution_core`, so a runner edit rebuilds
  only this crate and the harness.

## Gotchas

The bundled public SDK makes ordinary HTTP requests. There is no tool-name
proxy or host-call bridge. Cancellation stops the process; it does not roll back
completed API writes. SDK and Handlebars bundles, the operation catalog and
the SDK's type declarations come from `crates/code_mode_assets`, generated from
the public SDK at build time by `packages/code-mode-sdk`. A POST that only reads
must be listed in the generator's `postReads`, or dry runs skip it.
The SDK adds `x-macro-sdk-verb` to each generated call from the hand-assigned
registry; the header is attached to that call's options before request dispatch.

Every request to an SDK origin carries `x-macro-code-execution: 1`, whatever
credential it carries. A program can drop it with a raw `fetch`, so a refusal
that must hold reads the credential's signed claims too: every code-mode
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
(`src/deno/egress.rs`): `--allow-net` names only that listener.
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
host fills both from the service URL crates. Leaving `webAppUrl` out of
`new Macro(...)` makes the SDK default to prod, so `webUrl()` links on dev and
local would point at macro.com.

The bootstrap bans timers before importing `main.mjs`, and the import map points
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
and `process.peak_rss_kib` (`src/deno/exit.rs`). Peak memory is `VmHWM`
sampled from procfs every 250 ms while the child runs, since it is gone
before the child's pipes close (a child that dies within one interval
shows only its startup peak); CPU time is read once more after they close.
A run the deadline, a cancellation or a protocol error cuts short records
the same fields with `process.killed = true` (its status is the runner's
kill). A child that ends on its own without exit code 0 after its terminal
frame logs one `Deno child ended abnormally` warning with the same fields.

## Checks

- `cargo test -p code_execution_outbound --lib -- --include-ignored` from the
  repository root with Deno available; real-process tests exercise permissions
  and cleanup.
- `cargo test -p code_execution_core` for admission and cancellation.

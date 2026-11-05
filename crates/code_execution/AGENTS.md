# JavaScript execution

## Scope

Runs a bounded JavaScript program in a fresh Deno process inside the calling
service. Session authentication, token issuance and execution storage belong to
`crates/agent_code_mode` and its composition root.

## Start here

- `README.md`: permissions, limits and the program contract.
- `src/domain/service.rs`: admission and cancellation.
- `src/outbound/deno.rs`: process lifecycle and restricted permissions.
- `src/outbound/deno/bootstrap.mjs`: program loading, unattended dry runs
  and final JSON protocol.
- `src/outbound/deno/check.rs`: type-checking TypeScript against the SDK.
- `src/domain/operations.rs`: the generated operation catalog (labels, routes,
  read or write) and the SDK fingerprint.

## Gotchas

The bundled public SDK makes ordinary HTTP requests. There is no tool-name
proxy or host-call bridge. Cancellation stops the process; it does not roll back
completed API writes. SDK and Handlebars bundles, the operation catalog and
the SDK's type declarations come from `crates/code_mode_assets`, generated from
the public SDK at build time by `packages/code-mode-sdk`. A POST that only reads
must be listed in the generator's `postReads`, or dry runs skip it.

Authenticated SDK requests carry `x-macro-code-execution: 1`, the only mark a
run under a plain user token (public MCP) has. APIs that ask a program to
confirm what a person picks by opening something read it; the calendar
mutation routes demand the copy's `inbox` from such requests.

The bootstrap bans timers before importing `main.mjs`, and the import map points
node timer and worker modules at `timers.mjs`. The bundled SDK's only timer is
the SSE reconnect delay, so a reconnecting event stream fails the same way.

The bootstrap replaces a result's `data` larger than `Limits::max_result_bytes`
with an outline and preview, keeping `reviews`; the frame limit stays the backstop.
An unattended result is never summarized: later routine steps read it whole, so
one over the limit fails the run with a message saying so.

## Checks

- `cargo test -p code_execution --lib -- --include-ignored` from the repository
  root with Deno available; real-process tests exercise permissions and cleanup.

# Code execution in the agent harness

`ExecuteCode` accepts a JavaScript ES module exporting `main`. This crate
also runs OCaml programs (below); `ExecuteCode` does not offer them yet. The agent harness
starts a fresh Deno 2.9.6 child for each execution; there is no separate runner
service. Macro SDK and Handlebars imports are bundled ahead of time, with no
per-run package download or TypeScript compilation.

```js
import Handlebars from 'handlebars';

export async function main({ macro, session, execution }) {
  const results = await Promise.all([
    macro.ai.decide({ input: 'First message', questions: { urgent: 'Is this urgent?' } }),
    macro.ai.decide({ input: 'Second message', questions: { urgent: 'Is this urgent?' } }),
  ]);
  return {
    data: Handlebars.compile('Classified {{count}} messages')({ count: results.length }),
    reviews: [],
  };
}
```

The context also exposes `token`, `hosts` and `webAppUrl` for explicitly
constructing `new Macro({ token, hosts, webAppUrl })` after importing `Macro`
from `@macro-inc/sdk`. `webAppUrl` is the deployment's web app origin, so
`webUrl()` links point at the environment the run is in.
`session` and `execution` are handles supplied by the authenticated host.
SDK methods perform normal authenticated HTTP requests. Promise concurrency is
ordinary JavaScript concurrency: there is no per-call Rust tool dispatch or
stdin/stdout request/reply bridge.

`ExecutionService` owns process admission, queueing, deadlines, cancellation, and
shutdown. The Deno adapter implements its process port. Session authorization,
execution journaling, and review policy belong to the `agent_code_mode` domain;
API services independently enforce the authenticated user's permissions.

The harness persists source before execution, then final status and returned
JSON or error. New executions do not automatically journal each HTTP response.
The result is untrusted program output, not proof that an external write occurred.
Review cards load their separately saved records. Code completion does not wait
for a user to submit those reviews.

## OCaml programs

`ExecuteRequest::language` is `Javascript` by default or `Ocaml`. An OCaml
program is one `main.ml` that calls `Code_mode.run` (the contract and an
example are in `packages/sdk-ocaml/README.md`, "Code mode"):

```ocaml
let () =
  Code_mode.run @@ fun { macro; session_id; _ } ->
  let reply = Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ()) in
  `Assoc [ ("contacts", `Int (List.length reply.contacts)) ]
```

Before Deno starts, `src/outbound/ocaml.rs` compiles it in the run's scratch
directory against the prebuilt bundle (`CODE_MODE_OCAML_DIR` when
`code_mode_assets` was built; without one an OCaml run fails saying so).
Each step is a child process with the same cleared environment, scratch
directory, CPU and priority limits and kill-on-drop as Deno, inside the run's
deadline and cancellation, with fixed command lines (no dune, ocamlfind,
`-pp` or `-ppx`, nothing from the program):

1. `ocamlc -nostdlib -I <stdlib> -I <cmi> -bin-annot -c main.ml`: only the
   SDK, its runtime, yojson, uri, `Macro_sdk_fetch` and `Code_mode` are
   visible, not the JavaScript interop.
2. `code_mode_policy main.cmt`: refuses `external` declarations and uses of
   `Obj`, `Marshal`, `Sys.command`, `Unix` and `Js_of_ocaml`, also through
   aliases. Defense in depth; Deno's permissions are the boundary.
3. `wasm_of_ocaml compile` and `link` against the bundle's archives, keeping
   only the program's own modules in scratch.

Compiler and policy errors fail the run with `FailureCode::Compile` and the
same diagnostic text `DenoChecker` gives: the problem ending in
`at main.ml:<line>:<column>`. `OcamlChecker` checks a program the same way
without compiling it to Wasm (`ocamlc -stop-after typing`, then the policy).

The run is the same Deno launch with the same flags, plus read access to the
bundle's library modules. The bootstrap checks for JSPI
(`WebAssembly.Suspending`), sets `globalThis.__macroCodeMode`, and evaluates
wasm_of_ocaml's loader with a `process` without env and a `require` serving
only `node:fs`, `node:fs/promises`, `node:path` and `node:tty`. The program's
stdout and stderr become log events, so it can't forge frames. Its SDK calls
go through the bootstrap's `fetch` with their `{service, operation}`
(`init.macroSdkOperation`): the same headers, dry-run gate, progress events
and result limits apply. They carry no `x-macro-sdk-verb` yet (a display
hint). An unattended OCaml program's client holds a stand-in token that
`fetch` replaces with the real one, so the program never sees the
credential; it takes no arguments yet.

Measured on big-pickle, 2026-11-16, median of 11 (one program, warm bundle,
cold processes): compile 62 ms; a whole OCaml run (compile, Deno start,
`Code_mode.run`, exit) 216 ms, against 106 ms for an empty JavaScript run.

## Unattended programs

A host can run a program with nobody watching (a routine step) by setting
`RunEnvironment::unattended`. Then:

- the source is TypeScript (`main.ts`); Deno strips its types on load;
- `main` receives `macro` plus the host's `arguments`, never `token`, `hosts`
  or trace context;
- its result is kept whole; one larger than `Limits::max_result_bytes` as JSON
  fails with a message naming its size, instead of being summarized;
- it runs with the token's permissions, the owner's. A dry run (`dry_run`)
  answers each SDK write with an empty result and reports it as `skipped`;
  writes are the catalog's non-read operations (`operations.json` from
  `crates/code_mode_assets`, with each operation's method, path and `write`), and an operation
  missing from it counts as one. A dry run also refuses authenticated non-GET
  requests at `fetch` unless a read matches; raw sockets (`Deno.connect`,
  `connectTls`, `startTls`), workers and Node's networking and process modules
  are unavailable.

A dry run is held back inside the process, not by the APIs: code written to
get around it can still write with the owner's permissions.

`DenoChecker` (`src/outbound/deno/check.rs`) type-checks a TypeScript program
against the SDK's generated declarations (`sdk-types.json` from `crates/code_mode_assets`)
without running it, plus a module of `declare global` types the host supplies
(the type of `main`'s argument). It skips checking declaration files
(`skipLibCheck`), which took about 40% of every check; a test checks the SDK's
declarations under the pinned Deno instead. `check_files` checks several
modules together (up to 40), so one can import another's types, and attributes
each diagnostic to its file. An import map sends every file URL outside the
check and the declarations to a root that doesn't exist, so a program can't
make the checker read, or quote, another file. `sdk_fingerprint()` is the
SDK version plus a hash of those declarations: code that checked under one
fingerprint stays valid until it changes.

## Limits and isolation

| Limit | Default |
| --- | --- |
| Concurrent Deno executions per harness replica | 8 (public MCP: 4 more) |
| Additional queued executions | 16 (public MCP: 8 more) |
| Total execution lifetime, including queueing, OCaml compiling and API calls | 30 seconds |
| JavaScript or OCaml source | 64 KiB |
| Model-facing result (larger `data` is summarized; an unattended one fails) | 64 KiB |
| Child frame | 256 KiB |
| Combined program stdout/stderr | 2 MiB |
| Additional bounded SDK progress frames | 64 KiB |
| Regular / advisory progress events | 1024 each |
| V8 old-space target per child | 128 MiB |
| CPU time per child (`Limits::max_cpu`, off by default) | kernel stops it (SIGXCPU) |
| Scheduling (`Limits::background`, off by default) | niceness 10 |

The supervisor clears inherited environment variables and gives each process a
private scratch directory. Deno permits reads only there and network connections
only to the configured API host/port destinations. Remote and npm imports,
writes, environment access, subprocesses, FFI, and system information are denied.
Timers, workers and other sleep primitives throw an error that points programs
at `macro.routines.create` for checking back later; this steers agents and is not
a security boundary.
The trusted bootstrap dynamically imports generated `main.mjs` so its module
reads are subject to the scratch read permission. Both static and dynamic imports
outside scratch are covered by real-runtime tests.

A short-lived normal user token arrives through the child's private stdin pipe;
it is not placed in argv, environment variables, or a credential file. The token
has the user's ordinary API permissions and expires independently of the child.
It is not revoked immediately when a process ends. Programs must not print or
return credentials. The supervisor redacts the exact run token from output and
errors to prevent accidental disclosure; this does not prevent deliberate encoded
disclosure by code that already holds the token. Direct SDK writes do not have per-call interactive approval.

Timeout, cancellation, a dropped caller, and harness shutdown kill and reap the
child before deleting scratch. API writes already accepted by a service may
complete afterward and must not be blindly retried. SDK operation events carry only an operation name, request identity and status.
They are bounded diagnostics, not proof of a committed action. Console output
and progress are program-authored and may be incomplete. W3C trace context and
`x-macro-code-execution: 1` are sent to configured service origins on
authenticated requests only.

Deno shares the harness container. The heap setting does not hard-limit native
memory, ArrayBuffers, or CPU; a container OOM can affect the harness and other
executions. A separate executor service remains a future isolation option.

## Verification

The pinned runtime is required for the opt-in real Deno suite. From the repository
root inside Nix, with `SQLX_OFFLINE` unset:

```sh
cargo test -p code_execution -- --include-ignored
```

The suite covers actual SDK HTTP authentication and concurrency, prebundled
Handlebars, plain JavaScript entry modules, filesystem/import/process/network
restrictions including redirects, output bounds, cancellation, deadlines,
backpressure, and cleanup, and the same for OCaml programs plus compiling,
the policy check and timeouts while compiling (they need
`CODE_MODE_OCAML_DIR`, see `AGENTS.md`). It makes no model-provider calls.

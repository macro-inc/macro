# Code execution in the agent harness

`ExecuteCode` accepts a JavaScript ES module exporting `main`. This crate
also runs OCaml programs and JS tools programs (below); `ExecuteCode` offers
JS tools programs to sessions whose owner has agent permissions. The agent harness
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
`-pp` or `-ppx`, nothing from the program). Each step runs in its own
process group, so stopping it also stops the binaryen tools wasm_of_ocaml
starts. `Limits::max_cpu` applies to each step, and each step's address
space is capped at 1 GiB with core dumps off (`RLIMIT_AS`, `RLIMIT_CORE`, set
before the step execs; binaryen runs on one thread so its stacks fit): a program's source drives
the compiler's memory, so one that builds types of exponential size fails
saying it needs more memory than code mode allows (only the runtime's
own fatal lines count, never a diagnostic echoing the source). Ordinary programs
compile in under 384 MiB.

1. `ocamlc -nostdlib -I <stdlib> -I <cmi> -bin-annot -c main.ml`: only the
   SDK, its runtime, yojson, uri, `Macro_sdk_fetch` and `Code_mode` are
   visible, not the JavaScript interop.
2. `code_mode_policy main.cmt`: refuses `external` declarations and uses of
   `Obj`, `Marshal`, `Sys.command`, `input_value`/`output_value`,
   `Camlinternal*`, `Unix` and `Js_of_ocaml`. What it guarantees: no value
   the program names is one of those, by path or by the unit that declared
   it, so aliases and opens still name them. A value's declaring unit
   changes only when its module is coerced to a signature the program
   writes (a constraint, a functor argument, a first-class module, an
   `include`); every coercion whose source module's type holds a forbidden
   value, or `Sys`/`Stdlib` as a submodule, is refused. That type is
   expanded in the environment it was typed in (rebuilt from the `.cmt`),
   through aliases to any local or library module, named module types,
   submodules and functor results; a type it cannot expand, or one too
   large to expand, is refused too. `Sys` and `Stdlib` themselves may be
   used only as a path prefix, opened, or renamed (`module S = Sys`), and
   `Stdlib` may not be bound to a module. It does not look inside the
   bundle's libraries (what their own code calls) and refuses some safe
   programs (coercing a module that holds `Sys` even where the signature
   hides it, `module type of Sys`). Defense in depth; Deno's permissions
   are the boundary: with the policy skipped (a test-only compile),
   `Sys.command` fails at run time because the loader's `require` has no
   `node:child_process`, and Deno denies running processes.
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
credential; it takes no arguments yet. That secrecy rests on the program
running no JavaScript (the policy check, and no `Js_of_ocaml` interfaces in
the bundle), not on Deno's permissions: JavaScript could patch `Headers`
and read the token as `fetch` sets it. A dry run answers a skipped OCaml
write with `{}`, which the SDK may fail to decode as the operation's reply,
so the program sees an error where a real run would have succeeded.

Measured on big-pickle, 2026-11-16, median of 11 (one program, warm bundle,
cold processes): compile 62 ms; a whole OCaml run (compile, Deno start,
`Code_mode.run`, exit) 216 ms, against 106 ms for an empty JavaScript run.

## JS tools programs

`Language::JsTools` (`js_tools`) runs a script in the JavaScript dialect of
`@opencode/codemode` (pinned 2.3.2): plain JavaScript with top-level `await`
and `return`, no classes, getters, imports or `require`, and no `fetch`,
`Deno`, `globalThis`, timers or `eval`. Its only way out is a tool call,
`tools.<service>.<operationId>({ path?, query?, body? })`: the spec name with
`-` written `_`, then the raw operationId, so the path is the permission
registry's key. The return value becomes the result's `data`, and
`context` holds `sessionId`, `executionId` and `webAppUrl`:

```js
const task = await tools.storage.create_task_handler({
  body: { taskName: "Fix login redirect loop", markdown: "Signing in from a deep link returns to the login page." },
});
const doc = await tools.storage.get_document_markdown({ path: { document_id: task.documentId } });
return { taskId: task.documentId, markdown: doc.markdown };
```

`search("create task")` inside a program lists operations and their
signatures; it calls nothing. The interpreter, the analyzer and the catalog
(`js-tools.mjs`, `js-tools.json`) come from `crates/code_mode_assets`, built
by `packages/code-mode-sdk` (its README covers the catalog and the analyzer's
rules). They are written into the run's scratch beside the SDK, and the run
gets exactly a JavaScript run's Deno flags (a test pins it).

Every run, in the bootstrap:

1. analyzes `main.js` with the bundle's `analyze`: a program that doesn't
   parse, or reaches operations the analysis can't see (aliasing `tools`,
   `require`, `import`, an unknown operation), fails with
   `FailureCode::Compile` and `main.js:<line>:<column>: <reason>`. With
   `RunEnvironment::allowed_operations` (the permission gate), every
   operation found must be one of them, or the run fails the same way
   before anything is sent;
2. runs it with one tool per catalog operation, of which only those found
   may run: the interpreter's `tool.before` hook refuses the rest;
3. sends each call through the generated SDK method itself (only the
   program's `path`, `query` and `body` reach it, and each path parameter
   must be one segment: no object, `.` or `..`), naming its operation to
   `fetch`, which adds the usual headers and the operation's verb, reports
   progress and applies the `allowed_operations` backstop (operation,
   method, host, route and route rivals) as for OCaml.

The token stays in the bootstrap: no value the program can reach holds it,
and tool results cross back as JSON. An error response throws
`HTTP <status>: <body>` to the program. The interpreter stops at the run's
deadline less 500 ms, so its logs still arrive and the run ends `TimedOut`;
it allows 256 tool calls and keeps at most a frame's worth of result and
logs. A JS tools program can't run unattended. The bootstrap gives the
interpreter back the timers it schedules with; the program has none.

`src/outbound/deno/js_tools_analyze.mjs` is the analyzer as a process, for
the permission gate: beside `js-tools.mjs` and `js-tools.json`, run with
the deny flags plus `--deny-net` and `--allow-read=<its directory>`, it reads
the source on stdin and prints one line of JSON in `macro_sdk_calls --json`'s
shape, plus a `diagnostics` status (its header has the interface). Analysis
takes about 0.1 s in a fresh process; a run adds about 0.1 s to load the
bundle and catalog.

`JsToolsAnalyzer` (`src/outbound/deno/analyze.rs`) is the `ProgramAnalyzer`
that runs it: it writes the three files once under its scratch directory,
runs at most `concurrency` analyses at once with one 10 s deadline for the
wait and the analysis (`CheckError::Busy` past it), reads at most 256 KiB of
answer, and treats a nonzero exit or any other answer as
`CheckError::Internal`. Its span is `code_execution.analyze` with
`language = "js_tools"`, `outcome` (`calls`, `cannot_analyze`,
`diagnostics`, `busy` waiting for a slot, `timed_out`, `internal`) and
`operations`, never the source.

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
| JavaScript, OCaml or JS tools source | 64 KiB |
| Tool calls per JS tools run | 256 |
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
the policy check, the compile memory cap and timeouts while compiling (they need
`CODE_MODE_OCAML_DIR`, see `AGENTS.md`), and for JS tools programs plus their
analysis, the gate's backstops and the analyzer process. It makes no
model-provider calls.

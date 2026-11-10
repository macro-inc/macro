# Code execution in the agent harness

`ExecuteCode` accepts a TypeScript ES module exporting `main`. The agent harness
type-checks it against the SDK, then starts a fresh Deno 2.9.6 child for each
execution; there is no separate runner service. Macro SDK and Handlebars
imports are bundled ahead of time, with no per-run package download; Deno
strips the types.

```ts
import Handlebars from 'handlebars';

export async function main({ macro, session, execution }: CodeContext) {
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

`ExecutionService` owns process admission, type checking, queueing, deadlines,
cancellation, and shutdown. The Deno adapters implement its process and
checker ports.

## Type checking before a run

An attended program (agent session or public MCP `ExecuteCode`) is checked
with `deno check` before it waits for a process slot, against the SDK's
declarations, Handlebars' and `CodeContext` (`src/domain/context.rs`), the type
of `main`'s argument: `session` and `execution` are declared only when the run
has them. Checking is strict, so `main`'s argument and any parameter TypeScript
can't infer need types.

- Type errors: the run fails with `FailureCode::Compile` and no process
  starts. The message lists up to 20 of the checker's diagnostics, each with
  its code, the offending line and `at main.ts:<line>:<column>`.
- The checker is busy (every slot and queue place taken) or fails: the run
  fails (`Limit` or `Internal`) and doesn't run unchecked.
- The check counts against the run's deadline and is cancelled with it.

A check takes about a second of one core and 250 MB. The harness shares one
checker between its executors: 4 slots and 48 queued, enough for every program
the session and public executors admit at once. Each check is a
`code_execution.check` span (`waited_ms`, `diagnostics`, `outcome`), and the
run's `code_execution.run` span records `check` (`passed`, `rejected`, `busy`,
`failed` or `skipped`).

Session authorization, execution journaling, and review policy belong to the
`agent_code_mode` domain; API services independently enforce the authenticated
user's permissions.

The harness persists source before execution, then final status and returned
JSON or error. New executions do not automatically journal each HTTP response.
The result is untrusted program output, not proof that an external write occurred.
Review cards load their separately saved records. Code completion does not wait
for a user to submit those reviews.

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
without running it, plus an ambient declaration module the host supplies (the
type of `main`'s argument). `ProgramImports` says whether `handlebars` resolves,
as it does for attended programs and not for unattended ones. `check_files` checks several modules together (up
to 40), so one can import another's types, and attributes each diagnostic to
its file. An import map sends every file URL outside the
check and the declarations to a root that doesn't exist, so a program can't
make the checker read, or quote, another file. `sdk_fingerprint()` is the
SDK version plus a hash of those declarations: code that checked under one
fingerprint stays valid until it changes.

## Limits and isolation

| Limit | Default |
| --- | --- |
| Concurrent Deno executions per harness replica | 8 (public MCP: 4 more) |
| Additional queued executions | 16 (public MCP: 8 more) |
| Total execution lifetime, including queueing and API calls | 30 seconds |
| Program source | 64 KiB |
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
The trusted bootstrap dynamically imports generated `main.ts` so its module
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
Handlebars, TypeScript and plain JavaScript entry modules, type checking before
a run, filesystem/import/process/network
restrictions including redirects, output bounds, cancellation, deadlines,
backpressure, and cleanup. It makes no model-provider calls.

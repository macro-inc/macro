# Code execution in the agent harness

`ExecuteCode` accepts a JavaScript ES module exporting `main`. The agent harness
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

The context also exposes `token` and `hosts` for explicitly constructing
`new Macro({ token, hosts })` after importing `Macro` from `@macro-inc/sdk`.
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

## Limits and isolation

| Limit | Default |
| --- | --- |
| Concurrent Deno executions per harness replica | 8 |
| Additional queued executions | 16 |
| Total execution lifetime, including queueing and API calls | 30 seconds |
| JavaScript source | 64 KiB |
| Final result / child frame | 256 KiB |
| Combined program stdout/stderr | 2 MiB |
| Additional bounded SDK progress frames | 64 KiB |
| Regular / advisory progress events | 1024 each |
| V8 old-space target per child | 128 MiB |

The supervisor clears inherited environment variables and gives each process a
private scratch directory. Deno permits reads only there and network connections
only to the configured API host/port destinations. Remote and npm imports,
writes, environment access, subprocesses, FFI, and system information are denied.
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
and progress are program-authored and may be incomplete. W3C trace context is
forwarded to configured service origins on authenticated requests only.

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
backpressure, and cleanup. It makes no model-provider calls.

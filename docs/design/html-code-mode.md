# Programs in HTML previews

Status: first slice on `dev/html-code-mode`. Reads run end to end. Write
consent, a separate execution pool, and saved per-file approval are not built.
The agent guide's "Program blocks in HTML previews" describes the slice that
ships.

## Goal

An HTML file opened in Macro can call the real Macro SDK. The program runs on
the server as the person viewing the file. The sandboxed preview receives only
the result.

## Why

`HtmlPreview` renders the file in an iframe with `sandbox="allow-scripts"` and
`srcdoc`, so scripts run, but the frame's origin is opaque. CORS rejects
`Origin: null`, and putting a credential in the file would let any script in
that file act as the viewer. The server already runs user-scoped programs
(`UserCodeMode`, the same path public MCP uses), so the page should hand the
program up and get the outcome back.

## Decisions

- **Who.** The viewer's own session. Only a directly signed-in user. A token
  minted for an agent's run is refused, so a program cannot start another run.
- **What.** Reads and writes. Writes are the user's own: `ToolCaller::Document`
  mints a token with no agent.
- **Where.** HTML file preview only (`HtmlPreview` in a code block and in Drive
  detail). Canvas artifacts are out. Render stays the default mode. No CSP is
  added to the preview.
- **How a file calls it.** Both forms: `macro.run(id, args)` runs
  `<script type="text/macro" id="…">`, and `macro.run(source, args)` runs the
  string. The program is TypeScript `async function main({ macro, ...args })`.
  `macro` is the SDK, already signed in. The frame never sees the token.
- **Consent.** A dry run goes first. Reads complete with no prompt. If the dry
  run's activity contains a write, the app lists those operations and asks
  before the real run. "Always allow writes for this file" is a server-side
  preference. Not built yet; the route already accepts `dryRun` because the
  routine-step contract does.
- **Limits.** Document runs get their own pool, smaller than agent and MCP
  runs: 2 concurrent per viewer, 30 s. The frame enforces the concurrency cap
  today; the server still shares the public MCP executor.
- **Rollout.** `enable-html-code-mode`, the same key on web and the harness.
  On in local dev. Off leaves the preview a plain sandboxed frame.
- **Build.** Deno for everything, no Vite. An artifact is a TypeScript
  project: client code plus server programs in `src/server/`, with npm
  dependencies. `deno check` type-checks both sides against the SDK
  declarations. `deno bundle` bundles the client into the HTML and each
  server program on its own. The client imports `#server/<name>`, which
  `deno.json` maps to generated stubs that call `macro.run(<hash>, args)`.
  React and Preact JSX work. Solid, Svelte, Tailwind and HMR need Vite and
  are out until required. The build runs in `code_execution`'s Deno sandbox,
  with npm reached through a registry proxy. Coding agents run the same
  commands in their own sandbox. The archived plugin compiler
  (`archive/plugin-platform-2026-08`, `packages/plugin-cli`) has the
  client/server import policy and per-entry hashing to port.

## Flow

```
HTML file
  <script type="text/macro" id="tasks">…main({ macro })…</script>
  <script>macro.run("tasks", { query }).then(render)</script>
        │  postMessage { source, arguments }   (per-frame token)
        ▼
HtmlPreview host
        │  POST /documents/{id}/code-executions
        ▼
agent harness
  UserOnly, flag gate, ToolCaller::Document
        │
        ▼
UserCodeMode  →  Deno, network limited to Macro hosts
        │  receipt { status, result, activity, error }
        ▼
frame promise resolves or rejects
```

The credential stays in the harness. Completed API writes are not rolled back
if the run is cancelled.

## What the slice contains

- `POST /documents/{document_id}/code-executions` on the agent harness
  (`crates/agent_code_mode/src/inbound/document_router.rs`). Body: `source`,
  `arguments`, `timeoutMs`, `dryRun`. Returns `UserExecutionReceipt`.
- `UserCodeMode::execute` takes an optional inputs contract. Document runs use
  it (TypeScript, `main` receives `macro` and arguments, never the token).
  Public MCP keeps the JavaScript contract.
- Web: `features/block-code/code-mode/` injects `window.macro` and posts
  results back. Calls go through `queries/document-programs.ts`. Span
  `block_code.run_document_program` carries the document id.
- The endpoint is app-internal in the SDK coverage list. An SDK user runs code
  directly.

## Left to build

1. Dry-run consent in the host: run with `dryRun`, prompt only when activity
   shows a write, then run for real. Persist "always allow" for that document.
2. A `Limits` profile and admission keyed by viewer and document, instead of
   the shared public MCP slots.
3. Show a failed run in the preview chrome. Today the frame's promise rejects
   and the page has to catch it.
4. The Deno build: bundle, generate stubs, and write a manifest of program
   hashes. The run route then takes a program hash instead of source.

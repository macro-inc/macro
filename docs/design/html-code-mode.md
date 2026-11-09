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
  On in local dev; the harness allows every run on a local stack, whose
  PostHog key is often a placeholder. Off leaves the preview a plain sandboxed
  frame.
- **Live updates.** `macro.on(events, handler, { ids })` pushes the viewer's
  entity events into the frame. The host opens the existing per-user event
  stream (`GET /webhook/events/stream`, the one the SDK's `macro.events`
  reads), filtered and access-checked on the server, one per frame with the
  union of its subscriptions. Only the event name and entity id cross into
  the frame, so every read still goes through `macro.run` as the viewer.
  Delivery is best-effort: a reconnect sends `macro.resync` and the page
  refetches. The app's GraphQL live queries were the alternative; the stream
  was chosen because agents already know its event names from the SDK.
- **Build.** The agent uploads one readable HTML file, and the backend
  builds it with Deno; there is no Vite and no toolchain on the agent's side.
  Server programs are `<script type="text/macro" id="…" lang="ts">` blocks
  whose default export takes `(args, { macro })`. Client code is a
  `<script type="module" lang="ts">` that imports its programs, typed, from
  `macro:programs` and `on` from `macro:client`. Both sides may import
  `npm:` packages. The backend extracts the blocks into virtual files,
  runs `deno check` against the SDK declarations, and runs `deno bundle` for
  the client and for each program. It hashes each bundled program and records
  the SDK operations it calls. The server computes this manifest, so it is
  trusted, not declared by the author. The build runs in `code_execution`'s
  Deno sandbox, with npm reached through a cached registry proxy and no
  install scripts. The stored document stays the source that agents and
  people edit. The built HTML is derived content keyed by the source's hash,
  and the preview loads it. React and Preact JSX work; Solid, Svelte,
  Tailwind and HMR need Vite and are out until required. The archived plugin
  compiler (`archive/plugin-platform-2026-08`, `packages/plugin-cli`) has
  the client/server import policy and per-program hashing to port.
- **Publishing.** Agents call one SDK method that uploads and builds, and
  returns the document with any diagnostics. Given an existing document, it
  saves a new version under the same id. A plain upload or an edit in Drive
  builds when first viewed. A failed build shows its diagnostics in the
  preview chrome instead of the page.

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
- Web: `code-mode/event-host.ts` answers `macro.on` from one stream per frame
  (`queries/document-events.ts` over `service-storage/event-stream.ts`), capped
  at 16 subscriptions. Span `block_code.document_events.stream` covers each
  connection and counts the events it delivered.
- The endpoint is app-internal in the SDK coverage list. An SDK user runs code
  directly.

## Left to build

1. Dry-run consent in the host: run with `dryRun`, prompt only when activity
   shows a write, then run for real. Persist "always allow" for that document.
2. A `Limits` profile and admission keyed by viewer and document, instead of
   the shared public MCP slots.
3. Show a failed run in the preview chrome. Today the frame's promise rejects
   and the page has to catch it.
4. The backend build: extract, check and bundle a stored HTML file. Cache the
   result by the source's hash, and keep the manifest of program hashes and
   operations.
5. The publish SDK method, which returns diagnostics and replaces an existing
   document in place.
6. The run route takes a program hash instead of source. It resolves the
   hash against the server's build of the document version the viewer can
   see.

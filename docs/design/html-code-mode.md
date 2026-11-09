# Programs in HTML previews

Status: on `dev/html-code-mode`. The server builds stored HTML documents
and runs their programs by id, with live events, and the built page runs
under a strict CSP. A separate execution pool and publishing are not built.
The agent guide's "Program blocks in HTML previews" describes what ships.

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
- **Where.** Stored HTML documents only, previewed in Drive detail. HTML in a
  chat or Markdown code block has no stored file to build, version or hash,
  so it stays a plain sandboxed frame. Canvas artifacts are out. Render stays
  the default mode. The built page gets a strict CSP as the first element of
  its head (`composeProgramDocument`): `default-src 'none'; script-src
  'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src
  data:; media-src data: blob:; connect-src 'none'; form-action 'none';
  base-uri 'none'`. A page that runs programs as the viewer can then run only
  its own inline code and show only inline media, so fetch, beacons, remote
  scripts, stylesheets and image URLs can't carry what it read out. CSP does
  not stop the frame navigating itself (`location = …?leak`); see Consent.
  The plain fallback frame runs no programs and gets no policy.
- **How a file calls it.** Only by program id. The client imports its
  programs from `macro:programs` and calls them as typed functions. The
  build compiles those calls into the host transport. `window.macro` and its
  messages are internal to the build output, not an API agents write
  against. A program's default export receives `(args, { macro })` and
  returns plain JSON; the build wraps it for the runtime, so authors never
  write `{ data }`. `macro` is the SDK, already signed in. The frame never
  sees the token.
- **Run route.** `POST /documents/{id}/code-executions` takes
  `{ sourceHash, program, arguments }`, never source. The server checks that
  the viewer can view the document, reads its current source, and runs the
  bundle stored under that program id in its build of it. A build is named by
  the hash of its source, so no storage version field is needed; a stale
  hash gets `409`.
- **Consent.** None, matching routine code steps: programs run with the
  viewer's full access, with no prompt and no write scopes. Routines dropped
  per-step write scopes (`refactor(routines)!: drop write scopes`) because a
  guard in the same Deno process as the code can be bypassed by patching the
  built-ins it uses or reading the token from the SDK, and a prompt or a
  declared scope enforced there would be the same unkeepable promise. Real
  enforcement would need the credential kept out of the sandbox behind a
  proxy that checks each request, as `agent_egress` does for coding
  sandboxes; that is not built. The accepted risk: a page someone else wrote
  can read the viewer's data and write it where its author can see it (a
  message, a document), or navigate the frame to carry it out. CSP closes the
  other network paths.
- **Limits.** Enforced only on the server: a per-viewer queue in front of a
  document-run pool, 2 running per viewer, 30 s each. The page waits in the
  queue instead of failing.
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
  `macro:programs` and `on` from `macro:client`. Neither side may import
  packages: no `npm:`, no remote modules. That keeps the build offline and
  every page's code in the document, at the cost of libraries and JSX
  frameworks; pages use TypeScript and the DOM. The backend extracts the blocks into virtual files,
  runs `deno check` against the SDK declarations, and runs `deno bundle` for
  the client and for each program, and keeps each program's bundle under its
  id for runs of that build. The build runs in `code_execution`'s
  Deno sandbox with no network. If packages are added later, they come
  through a caching registry proxy, at exact versions with recorded
  integrity hashes. The stored document stays the source that agents and
  people edit. The built HTML is derived content keyed by the source's hash,
  and the preview loads it. Solid, Svelte, Tailwind and HMR would need Vite
  and are out. The archived plugin
  compiler (`archive/plugin-platform-2026-08`, `packages/plugin-cli`) has
  the client/server import policy and per-program hashing to port.
- **Publishing.** Agents call one SDK method that uploads and builds, and
  returns the document with any diagnostics. Given an existing document, it
  saves a new version under the same id. A plain upload or an edit in Drive
  builds when first viewed. A failed build shows its diagnostics in the
  preview chrome instead of the page, and a failed run shows its message in
  a dismissible notice above the page.

## Flow

```
stored HTML document
  <script type="text/macro" id="tasks" lang="ts">export default (args, { macro }) => …</script>
  <script type="module" lang="ts">import { tasks } from 'macro:programs'; …</script>
        │  GET /documents/{id}/build          (view access, flag gate)
        ▼
agent harness: read the stored file, check, bundle, cache by source hash
        │  { sourceHash, html, programs }  or  { diagnostics }
        ▼
HtmlPreview renders the built page with window.macro
        │  postMessage { program, arguments }   (per-frame token)
        ▼
POST /documents/{id}/code-executions { sourceHash, program, arguments }
        │  409 if the document changed since the build
        ▼
UserCodeMode runs the stored bundle as ToolCaller::Document
  →  Deno, network limited to Macro hosts
        │  receipt { status, result, activity, error }
        ▼
the program's value reaches the page's typed call
```

The credential stays in the harness. Completed API writes are not rolled back
if the run is cancelled.

## What is built

- `code_execution`: `ProgramBundler` (`deno bundle`) on the checker's confined
  workspace; the import map resolves `macro:programs` and `macro:client`.
- `agent_code_mode`: `document_programs/page_build.rs` (extract, check programs
  alone and with the client, bundle each, assemble the page; diagnostics by
  block), `DocumentPrograms` (source-hash cache, run by id, `Changed` on a
  stale hash), and the two routes in `inbound/document_router.rs`, which mint
  a view receipt in the handler.
- `agent_harness_service`: `code_mode/document_sources.rs` reads the stored
  file (at most 2 MiB) through the in-process documents service Macro's tools
  use, under the viewer's receipt; storage's internal routes don't accept an
  internal principal for document content. The build uses the routine
  checker, runs use public MCP's executor.
- Web: `HtmlPreview` renders the build or its problems; `code-mode/` carries
  `run` by program id and `on`, and puts the strict CSP first in the built
  page's head. The latest failed run shows above the page until dismissed,
  whether or not the page catches its call's rejection. Spans: `document_programs.build`,
  `document_programs.run`, `block_code.run_document_program`,
  `block_code.document_events.stream`.
- Both routes are app-internal in the SDK coverage list.

## Left to build

1. The publish SDK method, which returns diagnostics and replaces an existing
   document in place.
2. A `Limits` profile with a per-viewer queue, instead of the shared public
   MCP slots and the frame's cap.
3. Optional: `program.live(args, render)`, which re-runs a program when a
   live event arrives for what it reads.

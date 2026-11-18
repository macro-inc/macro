# Client document sessions

How the browser (and native hosts) edit, persist and sync a collaborative
document. Rust crates hold all policy; the host only executes effects.
The server side of the socket is described in [sync-router.md](sync-router.md).

```text
packages/lexical-wasm-view            DOM view: rendering, input, selection
packages/collaboration/src/session/   JS executor: sockets, timers, IndexedDB
        |  Bebop cold messages + flat Diff + primitive hot inputs
crates/client/document_session_wasm   wasm-bindgen cdylib (EditorSession, DocSession, SyncRouter)
        |
crates/client/document_session        EditorCore or generic Loro containers + sync
        |
crates/client/doc_sync_core           deterministic sync machines: WAL, convergence, router
```

`crates/client/document_session_ffi` exposes the same session to native hosts
through UniFFI; no native host integration is in this tree.

## Editor layer

The editor model is a Rust port of Lexical 0.45 under `crates/client/lexical/`:
`lexical_model` (values, registry, transactions, commands), `lexical_rich_nodes`,
`lexical_markdown`, `lexical_html`, `lexical_loro` (commit projection into Loro)
and `macro_document_model` (Macro's nodes, plugins and application registry).
`document_session` composes them with `doc_sync_core`.

In the web app the `rust-editor-model` feature flag (`RUST_EDITOR_ENGINE`, read
once at boot) selects this engine for the document body only
(`RustMarkdownEditor`); every other editor, and every `lexical`/`@lexical/*`
import, stays on upstream Lexical. Code tokenizing stays in TypeScript: the body
supplies Source's Prism tokenizer to the session.

## Host contract

- The core is deterministic: no I/O, clock reads, random generation or
  unordered output iteration. The host supplies both clocks (monotonic and
  wall), peer ids and entropy, and executes the returned effects. The
  `rust-sync-core-determinism` ast-grep rule enforces this in `doc_sync_core`
  and `document_session`.
- `SyncCore::handle` consumes one input and clears and refills one output
  buffer. Each host input enters the shared handle path exactly once; surface
  imports queue their view effects in the same output as the sync input that
  caused them.
- The host executes storage effects in issue order per document and reports
  durable completion. It sends `Ready` after applying `Seeded`.
- Effective access (`effective_access`) is an observation of the current
  authorization. Reading it never grants a later admission; every input still
  passes the normal readiness and access checks.

## Durability: the WAL

Every local edit is appended to a per-document write-ahead log in host storage
before it is pushed.

- Append is idempotent on `(doc, owner, seq)`; retry only writes whose outcome
  is uncertain.
- Adopting another owner's rows (for example from a closed tab) is one
  conditional transaction that preserves delivered and quarantine flags. The
  exact selected rows, with their delivered flags and bytes, cross the WASM ABI.
  A changed selection or snapshot-derived cover is refused without mutation. A
  timed-out adoption stays correlated until its transaction result arrives.
- Storage is never wiped automatically. Pruning requires a durable covering
  snapshot, and snapshot covers wait while any append is pending.
- Rows the server cannot accept are parked (Poison or Gap) and quarantined until
  their TTL. Poison is never inferred from a missing acknowledgement, and the
  durable prefix never advances over parked rows.
- Server evidence that a row was delivered comes only from checksum-valid bytes
  of rows in an acknowledged own push. The server does not echo a sender's
  broadcast, so local document version vectors never count as proof.
- Confirmed cutoffs are captured from `oplog_frontiers` at seed, convergence and
  reset confirmation points, never advanced to current local edits.
- Leaving the page (`Hidden`, `PageHide`, `Stop`) flushes the pending coalesced
  append first. `Stop` replies `Stopped` only after that terminal append
  completes, and repeated `Stop` is idempotent.

## Startup

Every seed source waits until local load and every in-flight WAL adoption
finish. A local snapshot takes priority over the remote one; retained rows are
replayed before `Seeded`. The editor initializes only after `Seeded`, so an
optimistic or socket seed never shows an empty model while durable rows are
being recovered. Initial core output is drained before input is accepted.

## Reset and rebase

When the live document must be replaced, the core rebuilds in a fresh document
and swaps only after validation.

- Throwaway imports (`probe_import`) and resets use fresh host-supplied peers;
  the live document is never mutated for a probe.
- When unacknowledged own rows exist, the core requests the complete retained
  server history, replays it plus checksum-valid WAL rows into a fresh document,
  and requires coverage of the old live version vector before replacing. On any
  failure the live document and rows are kept; a shallow server snapshot is never
  substituted before private rows replay.
- Read-only parking takes precedence over a needed rebase; a regrant resumes the
  same retained bytes through the ordinary push.
- Bindings and undo history are rebuilt after a reset.

## Transport

`Connection` handles socket generations, heartbeat and backoff.

- Direct sessions: `Socket*` effects go to the socket named by `ConnId`.
- Routed sessions: `RouterCore` multiplexes independently authorized documents
  over one physical socket. Inner `SocketSend` frames go to `RouterInput::Send`;
  `RouteReconnect` and `RouteDetach` run on the shared router, which never
  closes the physical socket for one document. `RouterOutput::to_sessions` feeds
  back as `Route` inputs.

## Presence

`PresenceBackend` is a clock-injected port; the default implementation sits on
`sync_protocol::presence`, keeps the Loro wire bytes and sender timestamps, and
expires peers strictly after the configured wall timeout. The core translates
wall expiry to its monotonic timer using the latest host `Now`. Remote cursors
are resolved against the live projection and republished after local and
remote edits.

## Comments

`PrepareComment` starts a fresh convergence round. `CommentReady` is emitted
only after that reply imports and every local row is confirmed delivered. The
session then stages the comment mark in a headless fork with a fresh peer
(`allocate_comment_peer`) and submits `PublishComment`. Publication retries are
idempotent; a stage expires or is cancelled on reset or close.

## Editor sessions

- Every new or forked Loro document gets its peer set immediately, with recorded
  timestamps disabled.
- IME composition: remote imports touching the composing paragraph are held in
  the live editor only, while the canonical sync/WAL document stays current and
  local IME edits publish immediately. The hold ends at composition end, after 3
  seconds or after 64 held imports, and merges through Loro.
- Undo grouping uses Loro's merge interval with the host wall clock; the
  monotonic clock never decides history grouping. History selection metadata
  stays local to the session, never in wire bytes.
- Durable node ids: application sessions mint `nanoid(8)` ids from the per-peer
  random stream; standalone sessions use `session-{peer}-{key}`. Duplicates are
  checked only against attached nodes, and pasted nodes get their ids
  invalidated before insertion. Snapshot, remote and history imports keep ids.
- Prepared and staged updates use the same admission handler and checks as
  ordinary input. Only an unadopted update can be recovered and retried; an
  adopted update without a publication receipt is fatal.

## WASM boundary

- `abi/session.bop` is the authoritative ABI. Bebop generates the Rust and
  TypeScript cold messages; keystrokes use wasm-bindgen primitives instead and
  reject lone UTF-16 surrogates. An ABI major mismatch is fatal; there is no
  fallback decoding.
- `takeOutput()` returns an owned envelope: a header plus aligned effects and a
  flat Diff of view operations. Text and selection inputs from the view return
  zero only when the model accepted them exactly; any other outcome carries
  authoritative text, selection or a full view repair.
- Generated files are never edited by hand. Each `.bop` has a generator in
  `packages/collaboration/scripts/` that writes both languages.
- Build profiles: the default build excludes the compatibility runtime. The
  separate `compat-web` artifact hosts JS Lexical classes over the same core and
  ships its own glue and declarations. `dev-probes` is for preview and test
  builds only, and production feature graphs reject it.

See `crates/client/document_session_wasm/README.md` for the output envelope
layout, size budget and preload behavior.

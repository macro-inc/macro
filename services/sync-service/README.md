# Sync service

Rust Cloudflare Worker and Durable Object service for native Automerge documents.
Each document/surface has independent state, an acknowledged operation log, and
durable snapshots. Authorization policy stays in `src/domain/document.rs`; HTTP,
WebSocket, and storage adapters share that policy and persistence pipeline.

## Rollout boundary

This implementation is **incompatible with pre-Automerge snapshots, updates, revisions,
and awareness**. It rejects incompatible stored snapshots rather than replacing
them with empty documents. It does not convert existing pre-Automerge history.

The Macro editors, collaboration package, spreadsheet engine, and AI editing
worker use `packages/automerge`, with native snapshots, head revisions, cursors,
undo, and JSON presence. Stable list objects are stored separately from their
ordering references so moves preserve concurrent edits. The raw JSON endpoint
materializes these lists for Lexical consumers. Browser persistence and gossip
use separate Automerge namespaces. Existing pre-Automerge documents still require an
explicit data migration; use this port with fresh isolated data only.

Use only `wrangler.automerge.toml` for this rollout. It creates the separate
`sync-service-playground-automerge` worker, fresh D1/KV bindings, and separate
Durable Object storage. It omits DSS callbacks so native snapshots cannot reach
the existing application's pre-Automerge storage. The old `wrangler.toml` resources remain
listed for reference, but its build and the legacy deployment workflow fail
closed. Do not bypass that guard with `--no-bundle` or a prebuilt deployment.

## Protocol

The Bebop envelope and WebSocket framing remain in `bebop/schema.bop` and
`packages/collaboration/src/websocket/platform/framing`. Payloads are now:

- Snapshot: `Automerge.save` bytes, retaining causal history.
- Update: concatenated Automerge change chunks (`Automerge.saveSince`), with
  checksum, size, operation-count, and dependency validation before mutation.
  Snapshots are not accepted as update deltas.
- Revision: UTF-8 JSON array of sorted hexadecimal change hashes. The legacy
  Bebop field name `vv` carries these bytes. Historical copy's `version_id` is
  a JSON array of change hashes, not peer/counter entries.
- Presence: UTF-8 JSON `{ "decimalPeerId": { "clock": 1, "value": {...} } }`.
  Null values are tombstones; presence expires independently of document state.
  Clients should refresh active presence within five seconds.

`GET /document/:id/state` returns `{snapshot, revision}`, both standard base64.
`POST /document/:id/update` accepts `{expectedRevision, update}` in base64.
Signed document permission tokens are required. Edit/owner permissions allow
writes; viewers and commenters cannot write. Stale revisions return 409.
Retrying an already-applied delta returns `applied: false`, including after other
edits. Successful writes are acknowledged after persistence.

WebSocket updates persist each accepted batch atomically, including batches
whose changes arrive out of causal order. A batch supports at most 64 deltas.
Reconnects resend unacknowledged changes and request missing changes by heads.
Recovery replays the pending log before checking the saved snapshot heads.
Surface freeze/import/verify/activate/retire receipts also use Automerge heads.

`client/document.ts` provides `AutomergeSession` and `initializeDocument` for
native TypeScript clients. Pending offline edits survive disconnection in memory;
applications must add snapshot/pending-change persistence for process recovery.
`crates/sync_service_client/src/automerge.rs` provides native Rust copy and surface
lifecycle contracts alongside the existing legacy client types.

## Local testing

Install the service dependencies with `npm ci` (Node 22.12+, 24, or 26+).
The service has its own `package-lock.json`. From this directory:

```sh
worker-build --profile sync-service-release --features create-default-state,migration-test-hooks
SYNC_MIGRATION_FAULT_TESTS=1 npx vitest run
```

The integration suite runs the compiled Rust Worker in Miniflare. It covers
authorization, malformed updates, convergence, offline replay, large framed
messages, historical copy, storage recovery, and surface migration faults.
Test hooks must never be enabled in a deployed build.

Run Rust tests from the repository root, with `SQLX_OFFLINE` unset:

```sh
cargo test -p sync_service
cargo test -p sync_service_client
just check
```

The Rust client transitively requires the local database configuration described
in `docs/DATABASE_DEVELOPMENT.md`. For a standalone worker, `just local-automerge`
uses port 8791 and separate `.wrangler-automerge` persistence. Documents must be
initialized with native snapshots before connecting; deployed builds do not
create missing documents implicitly.

For the full local infrastructure use the repository's `just run_local` flow
(`docs/RUNNING_LOCALLY.md`) with an isolated instance and a rebuilt sync image.
Its `/sync` proxy route reaches the local worker. The browser harness uses a new
random document and the local-only permission key:

```sh
bun scripts/serve-smoke.ts http://localhost:<proxy-port>/sync
# Open http://localhost:3000 in Chrome.
```

It verifies two native browser peers, concurrent offline/online edits, reconnect,
matching heads, and reload into a fresh peer. This verifies the service protocol;
it does not exercise the existing Macro editor.

## Isolated PLAYGROUND deployment

Authenticate Wrangler with the intended Cloudflare account, then run here:

```sh
just deploy-playground-dry
just deploy-playground
```

Wrangler provisions the fresh resources on first deploy; the recipe then applies
the D1 migrations. Set `SYNC_SERVICE_KEY_PLAYGROUND` as a secret on the new worker
before exercising internal copy or surface lifecycle endpoints. The PLAYGROUND
permission signing key is the local test key; this environment is only for
disposable test documents. The native browser harness can also target the
deployed worker URL. No production or shared dev deployment is part of this port.

## Side effects

When configured for a compatible application, snapshot/content notifications go
to DSS and carry distinct verified editor identities. Notification failures do
not block document saving. Anonymous edits, duplicate deltas, and idle presence
do not add editors. The isolated configuration deliberately leaves these
application callbacks unconfigured.

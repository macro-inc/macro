# Deterministic spreadsheet worker

`POST /spreadsheet` accepts
`{ documentId, documentToken, request: { action: "read" | "calculate" | "edit", ... } }`.
The precise contract lives in `packages/spreadsheet/src/ai-types.ts` and is mirrored
by the Rust document tool types. This endpoint needs `SYNC_WS_BASE`; it does not
call an LLM or require model API keys.

The worker loads a coherent Loro snapshot and revision using
`GET /document/:id/spreadsheet-snapshot`. Reads and scratch calculations are pure.
Edits operate on a disposable fork and send one delta with the caller's expected
revision to `POST /document/:id/spreadsheet-update`. The Durable Object validates
the signed document grant, compares the live version and persists/broadcasts the
delta atomically. A stale revision returns 409 and requires a fresh read.

Authorization is checked at both Rust's entity-access boundary and the sync
endpoint. Viewers may read and calculate; mutations require edit or owner access.
Comment-only grants do not permit spreadsheet writes. Neither an internal key
nor a token for a different document substitutes for the document grant. Sync
records attribution from signed claims, not a client-supplied peer identity.

Limits: 1 MiB request JSON; 4 MiB binary snapshot or delta; 500 returned read cells
and 100,000 UTF-8 result bytes; 20 scratch formulas; 25 edit operations and 2,000
edited/override cells. A 30-second abort signal bounds asynchronous work. A
monotonic elapsed-time check after synchronous WASM calculation prevents an
over-budget edit from committing, even before a timer callback can run. WASM
execution itself is not preempted by that timer; Cloudflare's CPU/memory limits
provide the hard runtime boundary. A transport failure during commit may leave a
successful write with a lost reply; reread before retrying.

## Local verification

From the repository root:

```sh
bun install
bun run --cwd services/ai-editing-worker test:spreadsheet
bun run --cwd services/ai-editing-worker type-check
bun run --cwd packages/spreadsheet type-check
```

Build the Rust sync worker using its usual build recipe, then build the actual AI
worker without deploying:

```sh
bun run --cwd services/ai-editing-worker prebuild
bunx --cwd services/ai-editing-worker wrangler deploy --dry-run --env dev --outdir /tmp/spreadsheet-ai-worker-build
SPREADSHEET_AI_WORKER_BUNDLE=/tmp/spreadsheet-ai-worker-build bun run --cwd services/ai-editing-worker test:spreadsheet:integration
```

The integration fixture runs both compiled workers in one local Miniflare
process. All sync, storage, telemetry and indexing traffic stays in the fixture;
it uses disposable storage and synthetic document tokens. It exercises real
IronCalc WASM, multi-sheet edits, what-if isolation, source/formatted/typed reads,
stale and concurrent revisions, atomic failures, permission denials and input
limits. It does not exercise a hosted chat model choosing tools or the hosted
document-permission service.

Do not start the default Wrangler configuration as a local spreadsheet backend:
its unqualified `SYNC_WS_BASE` points at production. Use the local stack's
`--env local`, an explicit local sync URL, or this Miniflare fixture.

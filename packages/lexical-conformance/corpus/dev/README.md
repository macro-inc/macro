# Dev document corpus

Development-only collection and count-only scanners for S4 §3.6 and R-5.
Replay calls the actual local lexical-service functions and real Rust WASM
binding. It never calls the deployed lexical-service.

From the repository root:

```sh
bun packages/lexical-conformance/corpus/run.ts pull
bun packages/lexical-conformance/corpus/run.ts scan
TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=4 bun packages/lexical-conformance/diff/build-wasm.ts
bun packages/lexical-conformance/corpus/run.ts replay
bun packages/lexical-conformance/corpus/run.ts diagnose
bun test packages/lexical-conformance/corpus/dev
```

The collector reads `DATABASE_URL` and `DOCUMENT_PERMISSION_JWT` from Doppler's
`cloud-storage-service/dev` config. It signs a per-document HS256 JWT with a
60-second expiry, document_storage_service issuer and admin access, and sends it
as a Bearer token. The internal service key does not authorize this dev route. Missing credentials or HTTP 401/403 stop collection.
It never uses a production config or accepts a configurable sync-service host.
The dev URL matches `infra/packages/shared/src/service_urls.ts`.

SQL executes in read-only transactions with timeouts. The query returns ids only
for at most 2,000 live Markdown documents, ordered by most recently updated and
then id. Encrypted sample.enc freezes those ids before fetching; resumed
collection, scans and replay consume only this manifest, regardless of other
cached files. This bounded sample is not a complete dev inventory.
Sync-service requests are GET-only, refuse redirects, and run serially at most
four per second. Error response bodies are never printed.

Only `/home/wolf/tmp/lexical-port/corpus` may hold pulled documents. The cache
directory has mode 0700; AES-256-GCM files and the local random key have mode
0600. Hashed source/id filenames permit resumable collection. Protect the key
with the cache; do not copy either into a repository, report, or CI artifact.
Reports contain counts and opaque ids only. No remote write is performed.

Run the scans before replay; replay also runs them first. `scan_for_lone_surrogate_escapes` counts decoded
unpaired UTF-16 units in values and keys, rather than matching escaped literal
text or valid surrogate pairs. `scan_magic_chip_status` aggregates missing,
null, known, and other statuses. `scan_reply_target_parent_keys` counts known
parent keys and extra keys without printing unknown names or values. A scan of
an empty cache is not evidence of zero affected dev documents.

Checks: the scanner test above, `bunx tsc --noEmit -p
packages/lexical-conformance/corpus/dev/tsconfig.json`, and scoped `just check`.


The oracle injects the same fixed clock, sequential seeded nanoid bytes and
absent browser hostname on both sides. `../normalize.json` enables no masks;
stored ids and timestamps remain compared. Snapshot routes compare decoded
Loro JSON; empty Markdown also compares frozen bytes. Gate pairs compare the
verdict and both normalized documents. Paired conversion errors are unverified,
never parity. Mismatches or unverified errors give exit 1 after all route counts;
fatal harness errors give exit 2. Source content diagnostics are disabled in the
isolated oracle process. Only schema-allowlisted node/field names enter the
histogram; arbitrary names become counts.

Replay covers Markdown, search, cognition v1/v2, comment-mark, XML, mentions,
reply extraction, agent composers and Markdown/Notion snapshots. Image
composition uses eligible corpus images. Notion uses existing literal source
fixtures because these Markdown documents do not retain Notion source inputs.
Legacy code/list synthetic fixtures supplement missing types. HTML is counted
as unported at the frozen model tip, never silently omitted.

Local telemetry uses the shared facade and localhost OTLP only. Pull propagates
trace context on GET. Replay traces scans and representative first-document
comparisons, with route, outcome, counts and opaque ids only. Credentials and
content are never traced.

`diagnose` rechecks the recorded failing opaque aliases and emits only counts
of structural categories using schema-allowlisted field names. It distinguishes
gate verdict differences from normalized-JSON differences without printing
values. The replay report retains a bounded alias list per route; diagnosis
does not imply coverage of failures beyond those recorded aliases.

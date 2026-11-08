# Dev document corpus

Development-only collection and count-only scanners for S4 §3.6 and R-5.
The TypeScript-versus-Rust replay is pending dev document access; this directory
currently supplies collection and scans only.

From the repository root:

```sh
bun packages/lexical-conformance/corpus/dev/run.ts pull
bun packages/lexical-conformance/corpus/dev/run.ts scan
bun test packages/lexical-conformance/corpus/dev/scan.test.ts
```

The collector reads `DATABASE_URL` and `DOCUMENT_PERMISSION_JWT` from Doppler's
`cloud-storage-service/dev` config. It signs a per-document HS256 JWT with a
60-second expiry, document_storage_service issuer and admin access, and sends it
as a Bearer token. The internal service key does not authorize this dev route. Missing credentials or HTTP 401/403 stop collection.
It never uses a production config or accepts a configurable sync-service host.
The dev URL matches `infra/packages/shared/src/service_urls.ts`.

SQL executes in read-only transactions with timeouts. The query returns ids only
for at most 2,000 live Markdown documents, ordered by most recently updated and
then id. This is a bounded dev document sample, not a complete dev inventory.
Sync-service requests are GET-only, refuse redirects, and run serially at most
four per second. Error response bodies are never printed.

Only `/home/wolf/tmp/lexical-port/corpus` may hold pulled documents. The cache
directory has mode 0700; AES-256-GCM files and the local random key have mode
0600. Hashed source/id filenames permit resumable collection. Protect the key
with the cache; do not copy either into a repository, report, or CI artifact.
Reports contain counts and opaque ids only. No remote write is performed.

Run the scans before replay. `scan_for_lone_surrogate_escapes` counts decoded
unpaired UTF-16 units in values and keys, rather than matching escaped literal
text or valid surrogate pairs. `scan_magic_chip_status` aggregates missing,
null, known, and other statuses. `scan_reply_target_parent_keys` counts known
parent keys and extra keys without printing unknown names or values. A scan of
an empty cache is not evidence of zero affected dev documents.

Checks: the scanner test above, `bunx tsc --noEmit -p
packages/lexical-conformance/corpus/dev/tsconfig.json`, and scoped `just check`.

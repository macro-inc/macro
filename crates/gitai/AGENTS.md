# gitai

## What it is

The domain of gitai-service, Macro's server for the open-source git-ai client:
ingest of metrics, notes and transcripts from git-ai daemons, and the read API
agents use for attribution. `services/gitai_service` wires it up.

## Start here

- `src/inbound/http.rs`: the router; `/worker/*` routes sit under the 64 MB
  body limit.
- `src/domain/service.rs` and `src/domain/ports.rs`: use cases and the storage
  ports they need.
- `src/domain/models.rs`: the repository allowlist and pinned client version.

## Scope

- Owns: the git-ai wire contract, redaction, repository filtering, device
  credentials, the S3 layout and the DynamoDB key design.
- Not here: config and startup → `services/gitai_service`; AWS resources →
  `infra/stacks/gitai-service`.

## Storage

- Events bucket (`outbound/s3.rs`): versioned, kept; IA after 90 days.
- Sessions bucket: unversioned; `sessions/` and `session-index/` expire after
  180 days, so a delete is real.
- Table (`outbound/dynamodb.rs`): string `pk`/`sk`, GSI `gsi1` on
  `gsi1pk`/`gsi1sk`, TTL on `expires_at` (epoch seconds).

## Recipes

- Add a client route: handler in `inbound/` → use case on `GitaiService` →
  port method in `domain/ports.rs` → adapter in `outbound/`. Register `/worker`
  routes in `worker_routes`, before the body limit layer.

## Checks

- `cargo test -p gitai`

## Gotchas

- S3 is the source of truth; the table is an index that can be rebuilt from it.
- Never log or put on spans transcript text, note content, keys or emails.
- Store unknown metric event ids and attribute positions untouched, so newer
  clients keep working.

## Related

- Skills: `cloud-storage-hexagonal-architecture`, `instrumentation`

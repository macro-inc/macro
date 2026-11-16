# search_processing_service (sps)

## What it is

Powers Search: a hexagonal service owning the search-event pipeline. Indexes
calls, agent sessions, documents, emails, and other entities into
OpenSearch, and exposes backfill HTTP routes for each.

## Start here

- `README.md`: the authoritative guide — architecture diagram, Kafka delivery
  contract, agent-session indexing/rollout, backfill routes table, and
  running/monitoring instructions. Read it before changing this service.
- `src/domain/service.rs` + `src/domain/ports.rs`: the `BackfillService`
  orchestrator — the single inbound contract for HTTP handlers.
- `src/inbound/kafka_consumer.rs`: live event decoding, ordering, commit, and
  retry logic.
- `src/process/`: indexing logic shared by the SQS and Kafka inbound adapters.
- `src/api/internal/backfill.rs`: the backfill HTTP handlers (thin
  pass-throughs to the orchestrator).

## Scope

- Owns: OpenSearch indexing for calls, agent sessions, documents, emails,
  channels, and other search entities; their Kafka/SQS ingestion and HTTP
  backfill routes.
- Not here: OpenSearch client/index mapping primitives → `crates/opensearch_client`;
  agent-session fold/transcript assembly → `crates/folds/agent_fold`.

## Checks

- From repo root, `SQLX_OFFLINE` unset:
  `cargo test -p search_processing_service --no-default-features --features processing,service`
- `cargo test -p agent_fold` and `cargo test -p opensearch_client` for the
  crates it depends on most.
- With local OpenSearch on `localhost:9200`:
  `cargo test -p opensearch_client empty_index_accepts_both_authors -- --ignored`
  (creates/deletes only a scratch index).

## Gotchas

- Deployment never creates OpenSearch indices/aliases — provision and verify
  the alias manually first (README "Agent-session indexing and rollout").
- Kafka offsets commit on in-memory handoff, not after OpenSearch write —
  there is a crash-loss window; recovery is the backfill routes, not replay.
- Full-scan backfills page by UUID, not `modified_at`, and cannot discover
  already-deleted IDs — target specific IDs for those.

## Related

- Docs: this directory's `README.md` · Rules: `.agents/rules/rust/architecture.md`

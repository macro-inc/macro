# Search Processing Service

This service owns the search-event pipeline:

- **Live calls**: the `search-processing-service` Kafka consumer reads call lifecycle events from `macro.calls` and indexes them into OpenSearch.
- **Agent sessions**: the same consumer subscribes to `macro.agent_session_lifecycle`, rereads the primary database, and indexes messages produced by `agent_fold`. Both user prompts and agent replies are searchable; raw ACP envelopes are not indexed. Agent-session backfills use this same direct indexing path, not SQS.
- **Other live entities**: Kafka handlers and legacy SQS workers drain events for the remaining search entities.
- **Backfills**: internal HTTP endpoints start tracked jobs. Most enqueue records onto SQS; agent sessions and properties index directly.

## Architecture

sps is hexagonal:

```
src/
  domain/                     # models, ports, BackfillService trait + orchestrator
  outbound/                   # Postgres backfill source and SQS publisher adapters
  api/internal/               # axum handlers — thin pass-throughs to the orchestrator
  inbound/kafka_consumer.rs   # live call event decoding, handoff, commits, and retries
  process/                    # indexing shared by the SQS and Kafka inbound adapters
```

The orchestrator is the single inbound contract for HTTP handlers. Swapping an adapter (e.g. in-process → HTTP-proxied owner service) is a wiring change, not a handler rewrite.

## Ingestion Ownership and Event Mapping

Kafka subscriptions are declared in `src/inbound/kafka_consumer.rs`, including agent-session lifecycle events. SQS remains available for legacy producers and backfills other than agent sessions and direct property indexing. The SQS call message contract and handler remain available so `POST /internal/backfill/calls` can enqueue call records with the existing backfill path.

### Agent-session indexing and rollout

There is no agent-session indexing feature flag. The deployed search-processing
binary subscribes to the existing `macro.agent_session_lifecycle` topic. Events
are invalidation hints: every event rereads current metadata and the effective
ACP log through the owning agent-session/fold services. It never indexes the
event's excerpt as a substitute for the transcript. Completed turns, questions,
renames, and deletions therefore converge on current persisted state.

Live events and backfills hold the same per-session PostgreSQL advisory lease
through the OpenSearch write. Lease connections have their own pool so waiting
workers cannot exhaust the pool used to load snapshots. Each reconcile writes
the parent and both authors' folded messages, refreshes them, then removes
documents from older projection generations. Missing sessions delete their
entire projection, even when triggered by an older event.

Provision and verify the `agent_sessions` index and alias manually before
deploying this consumer; deployment does not create indices. Normal parent and
bulk writes require an alias, so a missing alias fails instead of automatically
creating an index. An explicit backfill `index_override` permits physical
indices. Use the OpenSearch helper runbook for an explicit repair.

For rollout:

1. Verify the `agent_sessions` alias exists with the join mapping defined in
   `infra/stacks/opensearch/helpers/scripts/create_indices.ts`. Do not reset
   unrelated indices or recreate an existing index just to deploy this consumer.
2. Deploy search-processing and confirm its consumer group is subscribed to
   `macro.agent_session_lifecycle`. The topic and shared MSK permissions already
   exist; the publisher does not need a deployment for this change.
3. Call the internally authenticated `POST /internal/backfill/agent-sessions`
   with `{}` to repair all existing sessions. It returns `202` and `{"job_id":
   "..."}`; poll `GET /internal/backfill/{job_id}` until completed. Its `enqueued`
   progress field counts sessions reconciled directly, not SQS messages.
   Retained Kafka history alone is not a complete historical backfill.
4. Verify a unique phrase from a new user prompt and a completed agent reply
   both return the session. Also verify a rename and deletion.

Use `{"agent_session_ids": ["<uuid>"]}` to repair selected sessions, including
removing a known deleted session's documents. `index_override` can target a
scratch/replacement index with the same mapping. A full scan walks existing rows
in bounded UUID pages and does not use `modified_at`: ACP log changes do not
necessarily update that timestamp. It cannot discover already-deleted IDs.

The shared consumer commits on in-memory handoff and drops events after exhausted
retries. Monitor dropped-event logs and use this backfill for recovery. Backfills
are not automatically scheduled or started by deployment.

Regression checks, from the repository root inside Nix, with `SQLX_OFFLINE` unset:

```bash
cargo test -p agent_fold
cargo test -p agent_session search
cargo test -p search_processing_service --no-default-features --features processing,service
cargo test -p opensearch_client
# With local OpenSearch running on localhost:9200; creates/deletes only a scratch index:
cargo test -p opensearch_client empty_index_accepts_both_authors -- --ignored
```

The empty-index check covers parent/child joins across both authors, idempotent
replays, transcript replacement, stale-child removal, and deletion. Do not rely
on a previously populated local index to validate ingestion wiring.

The `macro.calls` lifecycle events map to search actions as follows:

| Event | Search action |
|---|---|
| `call.record_archived` | Full upsert of the call and transcript segments |
| `call.record_updated` | Full upsert so edits such as `custom_name` reach search |
| `call.record_summarized` | Full upsert so the generated call name reaches search |
| `call.record_deleted` | Remove the individual call by `call_id` |
| `call.started` | Ignore after decoding |
| `call.recording_ready` | Ignore after decoding |

Upserts read the current call state from Postgres and overwrite the indexed representation, making repeated delivery safe. Kafka events do not carry an index override; reindexing and backfill-specific options belong to the SQS path.

### Kafka Delivery Contract

- The durable consumer group is `search-processing-service`. Its subscriptions are declared in `src/inbound/kafka_consumer.rs`.
- The poll loop shards decoded events by entity ordering key across ten sequential workers, each with a bounded 16-message channel. Sending waits when the selected channel is full, stopping polling and committing until that worker catches up. Events for the same entity stay ordered.
- An offset is committed asynchronously immediately after a successful in-memory handoff, not after OpenSearch processing. This commit-after-handoff design creates a loss window: a process or host crash can lose committed events still in those buffers. If the worker channel closes before handoff, the offset is left uncommitted for redelivery.
- Malformed, keyless, and unsupported-schema records are logged and committed without handoff so a poison record cannot wedge a partition. Commit failures are logged and may cause duplicate delivery, which is safe because full upserts and per-call deletes are idempotent.
- Processing gets three total attempts, with retries after 1 and 2 seconds. Exhausted events are logged and dropped so later events can continue.

## Running Locally

Needs valid AWS credentials (secrets manager + SQS).

Two encrypted env bundles live at the repo root:

- `.env-local.enc` — local backing services via docker-compose.
- `.env-localdev.enc` — dev backing services (dev RDS, dev OpenSearch). Usually what you want for ad-hoc sps work.

`just get_environment <arg>` decrypts `.env-local<arg>.enc` into `.env`. Pass `dev` for the dev-targeting bundle, or no arg for the fully-local one.

```bash
# from repo root — pick one:
just get_environment                 # .env-local.enc       (local services)
just get_environment dev             # .env-localdev.enc    (dev services)
```

The repository already provides a Kafka broker in `docker/docker-compose-databases.yml`. Start it for fully local processing:

```bash
docker compose --project-directory . -f docker/docker-compose-databases.yml up -d kafka
```

Use `KAFKA_BROKERS=localhost:9092` when sps runs directly on the host. A service container attached to the compose `databases` network must use `KAFKA_BROKERS=kafka:29092`; `localhost` inside that container refers to the container itself. Keep the broker value supplied by the dev environment bundle when running against dev infrastructure.

```bash
cd services/search_processing_service

# Fully local host process:
KAFKA_BROKERS=localhost:9092 cargo run

# Or, with the dev-targeting environment bundle:
cargo run
```

Override `SEARCH_EVENT_QUEUE` on a per-run basis (e.g. backfills onto a scratch queue) so you don't consume the shared dev queue:

```bash
SEARCH_EVENT_QUEUE=search-event-queue-<scope>-<you> cargo run
```

When `DATABASE_URL_READONLY` is set, backfill reads run against the macrodb read-replica so they do not contend with writes on the primary. The queue workers always read from the primary (replica lag could cause them to miss rows they are meant to index). When the env var is absent, backfills fall back to the primary.

To run the API surface without the SQS or Kafka worker loops:

```bash
cargo run --features disable_processing
```

## Rollout, Monitoring, and Recovery

1. Configure `KAFKA_BROKERS` and the required MSK read permissions, then deploy the Kafka consumer while the live SQS call producer is still enabled.
2. On the first deployment, the new `search-processing-service` group has no committed offsets, so `auto.offset.reset=earliest` replays the retained `macro.calls` history. This replay and the temporary dual delivery from Kafka and SQS are safe: call upserts are full idempotent overwrites, and deletes are idempotent delete-by-query operations.
3. Before disabling live SQS call publication, confirm the consumer-group lag on `macro.calls` has caught up, worker errors are healthy, and the `call_records` index is fresh. Continue monitoring lag after cutover.
4. Watch service logs for Kafka receive/decode/commit errors, processing retry warnings, events dropped after five attempts, and consumer supervisor restarts. A commit error can result in a safe duplicate; a dropped processing event or crash in the commit-after-handoff window can require recovery.

For the local broker, inspect group lag with:

```bash
docker compose --project-directory . -f docker/docker-compose-databases.yml exec kafka \
  /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:29092 \
  --group search-processing-service \
  --describe
```

During the dual-delivery window, rollback the consumer deployment while SQS continues to provide live call indexing. After the SQS producer has been disabled, first roll back that producer change to resume SQS delivery, then roll back the consumer if needed.

Use `POST /internal/backfill/calls` after a rollback, a dropped upsert, or a suspected transition gap. An empty body re-enqueues every archived call through SQS; `{"call_ids": ["<uuid>"]}` targets known calls. This restores existing call documents but does not synthesize a delete event for a call that no longer exists, so investigate dropped delete logs by call ID.

## Backfill HTTP Routes

Every search-indexed entity has a POST endpoint on sps's internal surface. They return `202 Accepted` with `{"job_id": "..."}`, share internal-auth via the `x-internal-auth-key` header, and accept a per-entity JSON filter in the request body. Poll `GET /internal/backfill/{job_id}` for status and the `enqueued` progress count.

| Entity | Route | Body (all fields optional) |
|---|---|---|
| Agent sessions | `POST /internal/backfill/agent-sessions` | `{"agent_session_ids": ["<uuid>"], "index_override": "agent_sessions_v2"}` — `{}` = all existing sessions, indexed directly |
| Calls | `POST /internal/backfill/calls` | `{"call_ids": ["<uuid>"]}` — empty = all archived calls |
| Chats | `POST /internal/backfill/chats` | `{"chat_ids": [...], "user_ids": [...]}` |
| Channels | `POST /internal/backfill/channels` | `{}` |
| Documents | `POST /internal/backfill/documents` | `{"file_types": ["pdf"], "sub_type": "task", "created_after": "...", "created_before": "..."}` |
| Emails | `POST /internal/backfill/emails` | `{"since": "2026-03-16T00:00:00Z", "index_override": "emails_v2", "batch_size": 100}` |

### Against dev (deployed service)

```bash
AUTH_KEY=$(aws secretsmanager get-secret-value \
  --secret-id document-storage-service-auth-key-dev \
  --region us-east-1 --query SecretString --output text)

curl -X POST https://search-processing-dev.macro.com/internal/backfill/calls \
  -H "Content-Type: application/json" \
  -H "x-internal-auth-key: $AUTH_KEY" \
  -d '{}'
```

Dev sps consumes the shared `search-event-queue-dev`; backfill messages will interleave with normal ingest. If the deploy brings a mapping change, recreate the relevant index (via `infra/stacks/opensearch/helpers/scripts/create_indices.ts`) before triggering the backfill so stale-mapping docs don't linger.

Monitor: `aws sqs get-queue-attributes` on the dev queue, `GET <dev-opensearch>/<index>/_count`, and CloudWatch logs for the `search-processing-dev` ECS task.

### Pre-shipping: validate with a local service + scratch queue

```bash
aws sqs create-queue --queue-name search-event-queue-<scope>-<you> --region us-east-1

# shell 1
just get_environment dev
cd services/search_processing_service
SEARCH_EVENT_QUEUE=search-event-queue-<scope>-<you> cargo run

# shell 2
curl -X POST http://localhost:8080/internal/backfill/calls \
  -H "Content-Type: application/json" \
  -H "x-internal-auth-key: local" \
  -d '{}'

aws sqs delete-queue --queue-url <scratch-queue-url> --region us-east-1
```

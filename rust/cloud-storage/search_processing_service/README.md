# Search Processing Service

This service owns the search-event pipeline:

- **Consume**: SQS workers drain `SEARCH_EVENT_QUEUE` and index into OpenSearch.
- **Backfill**: internal HTTP endpoints re-enqueue every indexable record of a given entity type onto that same queue. Every entity's backfill funnels through sps so operators have one URL surface to remember.

## Architecture

sps is hexagonal:

```
src/
  domain/           # models, ports (CallBackfill, ChatBackfill, ...), BackfillService trait + orchestrator
  outbound/backfill/  # one Postgres-backed adapter per entity (calls/chats/channels/documents/emails)
  api/internal/     # axum handlers — thin pass-throughs to the orchestrator
  process/          # existing search-event workers
```

The orchestrator is the single inbound contract for HTTP handlers. Swapping an adapter (e.g. in-process → HTTP-proxied owner service) is a wiring change, not a handler rewrite.

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

cd rust/cloud-storage/search_processing_service
cargo run
```

Override `SEARCH_EVENT_QUEUE` on a per-run basis (e.g. backfills onto a scratch queue) so you don't consume the shared dev queue:

```bash
SEARCH_EVENT_QUEUE=search-event-queue-<scope>-<you> cargo run
```

When `DATABASE_URL_READONLY` is set, backfill reads run against the macrodb read-replica so they do not contend with writes on the primary. The queue workers always read from the primary (replica lag could cause them to miss rows they are meant to index). When the env var is absent, backfills fall back to the primary.

To run the API surface without the worker loop:

```bash
cargo run --features disable_processing
```

## Backfill HTTP Routes

Every search-indexed entity has a POST endpoint on sps's internal surface. They all share the same response shape (`{"enqueued": <usize>}`), share internal-auth via the `x-internal-auth-key` header, and accept a per-entity JSON filter in the request body.

| Entity | Route | Body (all fields optional) |
|---|---|---|
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
cd rust/cloud-storage/search_processing_service
SEARCH_EVENT_QUEUE=search-event-queue-<scope>-<you> cargo run

# shell 2
curl -X POST http://localhost:8080/internal/backfill/calls \
  -H "Content-Type: application/json" \
  -H "x-internal-auth-key: local" \
  -d '{}'

aws sqs delete-queue --queue-url <scratch-queue-url> --region us-east-1
```

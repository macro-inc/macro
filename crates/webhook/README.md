# Webhook crate

This crate provides webhook management, Kafka event ingestion, workspace and
filter matching, FIFO SQS fan-out, tracked HTTP delivery, and retry handling.
`document_storage_service` composes the production adapters and runs both the
Kafka consumer and the queue worker.

## Management and validation

The inbound Axum API supports:

- `POST /webhooks`
- `PATCH /webhooks/{webhook_id}`
- `DELETE /webhooks/{webhook_id}`
- `POST /webhooks/{webhook_id}/validate`

Validation sends a signed `webhook.validation.test` event to the configured
endpoint and persists the result in `is_valid`. Validation attempts use the
existing `rate_limit` crate with the key
`per-user-validate-webhook:{macro_user_id}:{webhook_id}` and a limit of 10
attempts per 3600-second window.

## Event ingestion and matching

The `webhook-event-ingestion` Kafka consumer reads `macro.documents` and
`macro.channels`. It supports these event names:

- Documents: `document.created`, `document.updated`, `document.deleted`, and
  `document.copied`.
- Channels: `channel.created`, `channel.updated`, `channel.deleted`,
  `channel.message_posted`, `channel.message_patched`,
  `channel.message_deleted`, `channel.message_attachment_created`,
  `channel.message_attachment_removed`, `channel.participant_added`, and
  `channel.participant_removed`.

For each event, ingestion asks `EntityAccessService` for the people who
currently have access to its entity. The matching workspace set contains each
person's Macro user ID, for personal webhooks, plus every team ID to which any
of those people belongs. The set is deduplicated before matching, so one person
or team is considered only once.

A webhook matches only when it is active, valid, not soft-deleted, owned by one
of those personal or team workspaces, and has one filter element that matches
both the exact event name and entity ID. An event match in one filter element
cannot be combined with an ID match in another element.

### Filter-ID semantics

Each filter requires `events`. `ids` is optional; an absent or `null` value
matches every entity ID for that filter's events:

```json
[
  {
    "events": ["document.created"],
    "ids": ["0197f776-6e7b-7c69-a251-780ae754d3e4"]
  }
]
```

For document events, IDs always mean the event's `document_id`. For every
channel event, IDs mean `channel_id`. This includes message, attachment, and
participant events: their message, attachment, and participant IDs are not used
for webhook filtering.

The matching query stores filters in the `webhook.filters` `JSONB NOT NULL`
column, protected by the `webhook_filters_is_array` constraint. It uses the
`webhook_filters_gin_idx` `jsonb_path_ops` GIN index for the event containment
probe and an exact JSONPath recheck to enforce same-filter event/ID matching.

Ingestion concurrently enqueues one message for every matched webhook and waits
for every send. It succeeds only if all sends complete. Repository,
workspace-resolution, queue, and database/internal access failures are
transient: the consumer makes up to five in-process attempts with 1, 2, 4, and
8-second delays. If all five fail, it exits without committing the Kafka offset;
the service supervisor restarts it and Kafka redelivers the event. Invalid
entity IDs, invalid broker contracts, empty Kafka payloads, and undecodable
Kafka messages are traced and skipped so they do not block a partition.

## Queue contract, deduplication, and ordering

The versioned SQS message contains a webhook ID and a normalized event. The
event retains the broker event ID, schema version, event name, entity type and
ID, entity ordering key, ingestion timestamp, and complete broker envelope.
The normalized `occurred_at` value, persisted as `event_occurred_at`, is the
time of webhook ingestion rather than an event-producer timestamp. Endpoint
URLs, custom headers, and signing secrets are deliberately omitted; the worker
reloads the webhook's current configuration before delivery.

The webhook event queue is FIFO. Each send explicitly uses:

- `MessageGroupId`: the webhook ID.
- `MessageDeduplicationId`: `<webhook_id>:<event_id>`.

This gives each webhook its own FIFO group and suppresses duplicate enqueue
operations during SQS's deduplication interval. The database additionally has a
unique `(webhook_id, event_id)` delivery constraint, so duplicate queue receipts
reuse the same delivery record.

FIFO preserves the order in which the current consumer enqueues events for one
webhook. It does not create a global order across Kafka partitions or across the
`macro.documents` and `macro.channels` topics. Consumers must therefore treat
the order as observed order, not total event order.

## HTTP delivery contract

Delivery is an HTTPS `POST` with a five-second timeout and redirects disabled.
The complete broker envelope is serialized as the exact request body; normalized
queue and delivery fields are not wrapped around or merged into it. Its shape is:

```json
{
  "event_id": "0197f776-6e7b-7c69-a251-780ae754d3e4",
  "schema_version": 1,
  "event_type": "document.deleted",
  "metadata": {
    "document_id": "0197f776-6e7b-7c69-a251-780ae754d3e4",
    "actor_user_id": null,
    "project_id": null
  }
}
```

The request includes:

- `Content-Type: application/json`
- `X-Macro-Event`: the exact event name
- `X-Macro-Event-Id`: the broker event ID
- `X-Macro-Timestamp`: the request time as Unix seconds
- `X-Macro-Signature`: `v1=<hex HMAC-SHA256>`

The signature input is the raw byte sequence
`<X-Macro-Timestamp>.<request-body>`, using the webhook signing secret. Custom
headers are included, but case-insensitive attempts to override a Macro header
are permanent configuration failures. Delivery applies the same HTTPS, DNS,
blocked-address, reserved-header, signing, and no-redirect protections as
validation.

Every 2xx response succeeds. Network errors, timeouts, DNS resolution failures,
and HTTP 408, 429, and 5xx responses are retryable. Other non-2xx responses and
invalid endpoint or header configuration are permanent failures. Delivery
attempts store response status, redacted response-header values, sanitized error
details, duration, and at most 4096 bytes of a UTF-8-lossy response-body preview.

## Delivery state, retries, and cancellation

The worker prepares a delivery idempotently, reloads the webhook, and records
each HTTP attempt in Postgres. Terminal delivered, canceled, permanently failed,
and exhausted deliveries are acknowledged without another HTTP request.
Successful attempts update `webhook.last_success_at`; attempted failures update
`webhook.last_failure_at`.

A delivery receives at most five HTTP attempts. Retryable failures use this
schedule:

| Failed attempt | Delay before next attempt |
| --- | --- |
| 1 | 30 seconds |
| 2 | 60 seconds |
| 3 | 120 seconds |
| 4 | 300 seconds |
| 5 | No retry; mark exhausted |

A permanent failure is recorded and acknowledged immediately. If the webhook is
missing, the message is acknowledged. If its current configuration is paused,
disabled, invalid, or soft-deleted, the delivery is marked canceled where
possible and acknowledged without consuming an HTTP attempt.

Delivery failures update tracking data but do not automatically pause or
disable a webhook. Automatic pause/disable policy is intentionally deferred;
operators or webhook owners must currently change status explicitly.

## Worker and at-least-once behavior

The worker long-polls in batches and processes each received batch sequentially.
A missing body, malformed JSON body, or unsupported queue contract version is a
poison message: it is traced and deleted immediately when SQS supplied a receipt
handle. A service, delete, or visibility-update failure is traced and leaves the
message for SQS redelivery. In deployed environments, repeatedly unacknowledged
messages move to the FIFO dead-letter queue after 20 receives.

The pipeline is at-least-once. SQS deduplication and the database uniqueness
constraint suppress ordinary duplicates, and a terminal database record
prevents another request. There is still an unavoidable crash window: an
endpoint can accept the HTTP request before the process records the result. A
redelivery can then recover the interrupted attempt and call the endpoint again.
Webhook receivers should use `X-Macro-Event-Id` as an idempotency key.

## Operations

### Queue configuration and local setup

`macro_queues::WebhookEventQueue` selects these FIFO queue names:

| Environment | Queue name |
| --- | --- |
| Local | `webhook-event-queue.fifo` |
| Develop | `webhook-event-queue-dev.fifo` |
| Production | `webhook-event-queue-prod.fifo` |

`OVERRIDE_WEBHOOK_EVENT_QUEUE` takes precedence over the environment default.
The webhook crate's `outbound::SqsWebhookQueue` wraps the shared
`sqs_client::SQS` and owns webhook-specific FIFO serialization, polling,
acknowledgment, and visibility changes.
Set the override to the full queue URL when connecting to LocalStack. From the
repository root, the canonical local orchestrator provisions the FIFO queue and
exports this value automatically:

```sh
just run_local --no-frontend
```

Services inside the local compose network receive
`http://localstack:4566/000000000000/webhook-event-queue.fifo`. The
`docker/docker-compose.local-e2e.yml` environment supplies the same override. Worker
polling defaults to 10 messages and a 20-second long poll and can be adjusted
with `WEBHOOK_QUEUE_MAX_MESSAGES` and `WEBHOOK_QUEUE_WAIT_TIME_SECONDS`.

### Tracing

Use a targeted `RUST_LOG` filter while diagnosing ingestion or delivery, for
example:

```text
RUST_LOG=info,webhook=trace,webhook::outbound::sqs_queue=trace
```

Ingestion spans expose event ID/name, entity type/ID, accessor count, workspace
count, match count, and webhook ID. Worker and delivery spans expose queue
message ID, webhook/event/delivery/attempt IDs, attempt number, delivery status,
HTTP status, duration, and retry delay. Queue polling and acknowledgment errors
are also traced. Request and response bodies, signing secrets, signatures, and
custom header values must not be added to logs; the implemented spans skip
those values.

For durable investigation, correlate `webhook_delivery` and
`webhook_delivery_attempt` rows by webhook/event ID and inspect the FIFO DLQ for
transport failures that survived 20 receives.

## Temporary limitations

- Webhook, delivery, and attempt IDs use prefixed UUIDv7 strings rather than true
  ULIDs.
- Webhook signing secrets are generated by the service and stored in plaintext
  in `signing_secret`, matching the existing bot secret storage approach.
- Custom headers are stored as JSON in the `headers` column; persisted delivery
  snapshots and response headers redact their values.

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

### Management lifecycle events

Successful authenticated management mutations publish schema-version-1 events
to `macro.webhooks`. The Kafka key is the subject webhook ID for every event:

| Event name | Emitted after | Sanitized metadata |
| --- | --- | --- |
| `webhook.created` | Creation | `webhook_id`, `workspace_id`, `created_by_user_id`, configuration snapshot, sorted `header_names`, and `created_at` |
| `webhook.updated` | The final PATCH mutation, including any validity reset | `webhook_id`, `workspace_id`, `actor_user_id`, requested PATCH fields, `headers_updated`, status transition, final `is_valid`, and `updated_at` |
| `webhook.deleted` | Soft deletion | `webhook_id`, `workspace_id`, and `actor_user_id` |
| `webhook.validated` | Validation-result persistence, whether valid or invalid | `webhook_id`, `workspace_id`, `actor_user_id`, `is_valid`, optional response status, and a sanitized message |

Created metadata exposes custom-header names but not their values. Updated
metadata exposes only whether headers were replaced. No lifecycle event includes
the webhook signing secret or custom-header values. A created event has this
wire-envelope shape (the Kafka key is not part of the JSON):

```json
{
  "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
  "schema_version": 1,
  "event_type": "webhook.created",
  "metadata": {
    "webhook_id": "wh_01998a2f-aaaa-7bbb-8ccc-dddddddddddd",
    "workspace_id": "team_0123",
    "created_by_user_id": "macro|creator@example.com",
    "name": "Document updates",
    "endpoint_url": "https://example.com/hooks/macro",
    "status": "active",
    "is_valid": false,
    "filters": [
      {
        "events": ["document.updated"],
        "ids": ["0197f776-6e7b-7c69-a251-780ae754d3e4"]
      }
    ],
    "header_names": ["Authorization", "X-Customer"],
    "created_at": "2026-07-20T17:01:02Z"
  }
}
```

Publication is post-mutation and fire-and-forget. The API result does not wait
for Kafka delivery, and a scheduling or publication failure does not roll back
or fail an otherwise successful mutation. There is no transaction, outbox, or
retry coupling persistence to publication, so a persisted mutation can have no
corresponding event; this accepted gap gives lifecycle production at-most-once
semantics relative to management mutations.

Only the authenticated create, patch, delete, and validate flows produce these
lifecycle events. Event ingestion, queue workers, HTTP delivery, and delivery
bookkeeping (including success/failure timestamp updates) do not produce them.

## Event ingestion and matching

The `webhook-event-ingestion` Kafka consumer reads every topic with public
events: today `macro.documents`, `macro.channels`, `macro.messages`,
`macro.webhooks`, `macro.agent_sessions`, `macro.agent_session_lifecycle`,
`macro.users`, and `macro.call_notifications` (declared once in
`crates/event_stream/src/topics.rs`, shared with the live stream's log; every
other topic is listed there as internal). The group starts at `Latest` on a
partition it has never committed, so a topic added to it does not replay its
retention.

What is delivered, to whom, and in what shape is declared by each event's
`TopicEvent::exposure()` in its producing crate (vocabulary in
`crates/event_exposure`) and normalized by `event_stream::domain::normalize`,
shared with live streams; `src/domain/ingestion.rs` only maps the declared
`Audience` to webhook workspaces. Internal events are skipped. `Preview`
events reach a webhook only when its creator has the `public-event-stream`
feature flag. Live streams (`GET /events/stream`) live in
`crates/event_stream`. It supports these event names:

- Documents: `document.created`, `document.updated`, `document.deleted`,
  `document.copied`, and `document.interaction` (a peer joined or left, or a
  periodic save). An update that only changes the icon or color is not
  delivered.
- Channels: `channel.created`, `channel.updated`, `channel.picture_changed`,
  `channel.deleted`,
  `channel.participant_added`, `channel.participant_removed`, and
  `channel.access_requested` (someone outside a private or team channel asked
  to join; the payload carries the request id). Participant events reach the
  channel's current members: a removed participant does not receive their own
  `channel.participant_removed`.
- Messages, on channels and document discussions alike: `message.posted`,
  `message.patched`, `message.deleted`, `message.attachment_created`,
  `message.attachment_removed`, and `message.mentioned`. Each payload carries
  the message's `parent` (`{"type": "channel" | "document" | "initiative" |
  "crm_company" | "crm_contact" | "call", "id": ...}`), which is also the
  event's `entity_type`.
- Webhooks: `webhook.created`, `webhook.updated`, `webhook.deleted`, and
  `webhook.validated`.
- Agent triggers: `agent_trigger.new` and `agent_trigger.existing`.
- Agent sessions: `agent_session.opened`, `agent_session.turn_started`,
  `agent_session.turn_ended`, `agent_session.settled`,
  `agent_session.waiting_for_input`, `agent_session.input_received`,
  `agent_session.command_rejected`, `agent_session.mentioned`,
  `agent_session.stopped`, `agent_session.renamed`, and
  `agent_session.deleted`.
- Users: `user.picture_changed` (`entity_type = "user"`, entity and ordering key
  are the user id; `file_id` and `url` are both null when the picture was
  removed). Persisted webhooks go only to the changed user's own personal and
  team workspaces. The live stream also reaches the user's contacts (user
  scope only) and the team-scoped streams of the user's teams.
- Calls: `call.started`, `call.ended`, `call.participant_joined`,
  `call.participant_left`, `call.recording_ready`, `call.summarized`,
  `call.ringing`, `call.answered`, `call.declined`, and `call.invited`.

Call events use `entity_type = "call"` and the call ID as the entity and
ordering key. Public events resolve the call's current accessor set before
matching personal and team webhooks or streaming to a subscriber. Ringing,
answered, declined, and invited events address one user: only that user's
personal webhook workspace and personal event stream may receive them. The
broker's recipient routing field is removed from delivered metadata.

For document, channel, and message events, ingestion asks `EntityAccessService`
for the people who currently have access to the entity, uncached, so a grant
or revocation just before the event counts; a message's entity is
its parent channel or document. The matching workspace set
contains each person's Macro user ID, for personal webhooks, plus every team ID
to which any of those people belongs. The set is deduplicated before matching,
so one person or team is considered only once.

`message.mentioned` is emitted once per distinct entity `@`-mentioned in a
message — users (`macro|<email>`), bots (`bot|<uuid>`), documents, and
any future mentionable kind. Bot mentions only emit when the bot is an active
channel participant; the author may itself be a bot. Like every message
event, access and `ids` filtering are by the message's parent: the entity is
the channel or document containing the message, and the mentioned entity
travels in the payload's `mentioned` field for consumers to filter on (e.g.
the SDK's `events.onSelfMention`).

Agent trigger events use `entity_type = "bot"`: a filter's `ids` selects one
bot's whole trigger stream. Access is gated by the message's parent (the
channel or document the mention, assignment or follow-up sits in); a composer
request reaches only its requester. Agent conversation messages are internal.

Agent session lifecycle events use `entity_type = "agent_session"` with the
session as entity and ordering key, so `ids` selects one session and events of
one session arrive in order. Access is gated by the session's own grants: its
owner, plus the members of the channel it was opened from. Subscribers who want
every session's facts filter by event name alone. `agent_session.settled` is
emitted when a turn ends with nothing queued behind it; a session that dies
mid-turn emits `agent_session.stopped` with the interrupted turn instead.

Webhook events use `entity_type = "webhook"` and take the event metadata's
`workspace_id` as the sole matching workspace. This is a strict owner-workspace
rule: ingestion does not perform an entity-access lookup or personal/team
workspace expansion, and actor membership does not make another workspace
eligible.

A webhook matches only when it is active, valid, not soft-deleted, owned by an
eligible workspace, and has one filter element that matches the event name,
the entity ID and, when present, the entity type. An event match in one filter element cannot be
combined with an ID match in another element. Because deletion is published
after soft deletion, a webhook cannot receive its own `webhook.deleted` event;
other eligible webhooks in the same owner workspace can receive it.

Team and GitHub audiences: a team event for every member matches the team's
workspace; an admin-only team event (invites) matches only the personal
workspaces of the team's current admins and owners, never the team workspace,
whose webhook creator need not be an admin. A GitHub installation's events
match the personal workspaces of the users who hold a claim on it (its user
and team owners with a linked GitHub account, the rule routines use) plus the
workspaces of the teams that own it.

### Filter semantics

Each filter requires `events`. `ids` and `entity_types` are optional; an
absent or `null` value matches every entity ID or type for that filter's
events. A webhook holds at most 50 filters (a live stream 32, the routine
trigger cap) of at most 100 events and 100 ids each; every other rule is
shared with live streams.

`events` entries are exact names, a family wildcard such as `document.*`, or
`*`. Wildcards expand at match time against the event catalog
(`event_stream::domain::catalog`), so a new event in a family arrives without
editing the webhook. They need the `public-event-stream` feature flag for the
webhook's creator; without it a wildcard is a literal name that matches
nothing, as before.

```json
[
  {
    "events": ["document.created"],
    "ids": ["0197f776-6e7b-7c69-a251-780ae754d3e4"]
  }
]
```

For document events, IDs always mean the event's `document_id`. For every
channel event, IDs mean `channel_id`. This includes attachment and participant
events: their attachment and participant IDs are not used for webhook filtering.
For message events, IDs mean the parent's id (`metadata.parent.id`, a channel
or document); message ids are not used for webhook filtering. For webhook
events, IDs mean the subject `webhook_id`;
an absent or `null` `ids` field matches every webhook ID in the strict owner
workspace.

The matching query stores filters in the `webhook.filters` `JSONB NOT NULL`
column, protected by the `webhook_filters_is_array` constraint. It narrows by
owner workspace (`webhook_workspace_status_idx`), probes the
`webhook_filters_gin_idx` `jsonb_path_ops` GIN index for the exact name, the
family wildcard and `*`, and rechecks with JSONPath that one filter element
matches both the event and the ID. Ingestion then applies the creator's flag
to wildcard and preview matches and checks `entity_types`.

### Ordering and delivery guarantees

- Events of one entity arrive in order (the Kafka key); there is no order
  across entities or topics.
- Webhooks are at least once from ingestion (below). Live streams are at
  least once inside the one-hour replay window when the client resumes with
  its cursor, best effort beyond it.
- Upstream publication is at most once relative to the write: producers
  publish after commit with no outbox, so a committed change can have no
  event. Clients that need certainty reconcile through the list APIs.

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
subscribed topics. Consumers must
therefore treat the order as observed order, not total event order.

## HTTP delivery contract

Delivery is an HTTPS `POST` with a five-second timeout and redirects disabled.
The broker envelope around the event's declared public payload is serialized
as the exact request body; normalized queue and delivery fields are not wrapped
around or merged into it. For every event delivered today the public payload is
the event's metadata, unchanged except for a call's recipient routing field, so
the body is the broker envelope. A field a producer adds to an internal event
is never delivered. Its shape is:

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

Blocked addresses are private, loopback, link-local (including cloud metadata),
CGNAT `100.64.0.0/10`, `0.0.0.0/8`, unique-local, multicast, reserved and
documentation ranges, IPv6 outside global unicast `2000::/3` (plus Teredo,
benchmarking and documentation inside it), and IPv6 forms that wrap one of
those IPv4 addresses (`::ffff:a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4). A preflight lookup gives the
user-facing message, and the HTTP client resolves through a filter that drops
blocked answers at connect time, so a DNS answer that changes after preflight
is still refused (reported as a retryable network failure). The client ignores
system proxy settings. Local environments
(`WebhookEndpointSchemePolicy::HttpAndHttps`) allow HTTP and local addresses.

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
`http://localstack:4566/000000000000/webhook-event-queue.fifo`. The local E2E
harness now receives the same override from its xtask-generated instance env.
Worker polling defaults to 10 messages and a 20-second long poll and can be adjusted
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

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

The `webhook-event-ingestion` Kafka consumer reads `macro.documents`,
`macro.channels`, `macro.messages`, `macro.webhooks`, `macro.agent_sessions`,
`macro.agent_session_lifecycle`, and `macro.users`. It supports these event names:

- Documents: `document.created`, `document.updated`, `document.deleted`,
  `document.copied`, and `document.interaction`.
- Channels: `channel.created`, `channel.updated`, `channel.deleted`,
  `channel.participant_added`, `channel.participant_removed`,
  `channel.picture_changed`, and `channel.access_requested` (someone outside a
  private or team channel asked to join; the payload carries the request id).
- Messages, on channels and document discussions alike: `message.posted`,
  `message.patched`, `message.deleted`, `message.attachment_created`,
  `message.attachment_removed`, and `message.mentioned`. Each payload carries
  the message's `parent` (`{"type": "channel" | "document", "id": ...}`).
- Webhooks: `webhook.created`, `webhook.updated`, `webhook.deleted`, and
  `webhook.validated`.
- Agent triggers: `agent_trigger.new` and `agent_trigger.existing`.
- Agent sessions: `agent_session.opened`, `agent_session.turn_started`,
  `agent_session.command_rejected`, `agent_session.mentioned`,
  `agent_session.turn_ended`, `agent_session.settled`,
  `agent_session.waiting_for_input`, `agent_session.input_received`,
  `agent_session.stopped`, `agent_session.renamed`, and
  `agent_session.deleted`.
- Users: `user.picture_changed` (`entity_type = "user"`, entity and ordering key
  are the user id; `file_id` and `url` are both null when the picture was
  removed). Persisted webhooks go only to the changed user's own personal and
  team workspaces. The live SSE stream also reaches the user's contacts (user
  scope only) and the team-scoped streams of the user's teams.
- Calls: `call.started`, `call.ended`, `call.participant_joined`,
  `call.participant_left`, `call.recording_ready`, `call.summarized`,
  `call.ringing`, `call.answered`, `call.declined`, and `call.invited`.
- Passwords: `passwords.access_request.resolved`, addressed to one account.

Call events use `entity_type = "call"` and the call ID as the entity and
ordering key. Public events resolve the call's current accessor set before
matching personal and team webhooks or streaming to a subscriber. Ringing,
answered, declined, and invited events address one user: only that user's
personal webhook workspace and personal event stream may receive them. The
broker's recipient routing field is removed from delivered metadata.

For document, channel, and message events, ingestion asks `EntityAccessService`
for the people who currently have access to the entity; a message's entity is
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
bot's whole trigger stream. Access is gated by the channel the mention sits in
for `agent_trigger.new`, and by the session for `agent_trigger.existing`.

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
eligible workspace, and has one filter element that matches both the exact
event name and entity ID. An event match in one filter element cannot be
combined with an ID match in another element. Because deletion is published
after soft deletion, a webhook cannot receive its own `webhook.deleted` event;
other eligible webhooks in the same owner workspace can receive it.

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
channel event, IDs mean `channel_id`. This includes attachment and participant
events: their attachment and participant IDs are not used for webhook filtering.
For message events, IDs mean the parent's id (`metadata.parent.id`, a channel
or document); message ids are not used for webhook filtering. For webhook
events, IDs mean the subject `webhook_id`;
an absent or `null` `ids` field matches every webhook ID in the strict owner
workspace.

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

## Live event stream and resuming

`GET /webhook/events/stream` is ephemeral: each process consumes every event
from the moment it starts and fans it out to its open streams. Each SSE event's
`id` is the broker event id (a UUIDv7). The process also keeps the last two
minutes of events, up to 4,096 (`StreamFeed`). A client that opens the stream
with `resume=true` and the standard SSE `Last-Event-ID` header first receives the retained events
minted from five seconds before it on (except the cursor's own event), through
the same filters and access checks, then live events. Replicas consume the
topics in their own order, so replay goes by when an event was minted rather
than where it sits in this replica's feed, and the lookback repeats some events
the client saw: the client drops repeats by id (macrod remembers its last 4,096, as many as the service retains).
A cursor minted from a timestamp works the same way. A `Last-Event-ID` that is not
a UUIDv7 is ignored and the stream opens live, never refused. Events older than the
retention, or published while the process was not consuming, are still missed.
macrod sends its last seen id on every reconnect, and a floor minted when it
started on its first open, so a session requested before its stream covered a
newly bound agent still reaches it. That floor uses macrod's clock against the
service's, so it assumes the two agree to within the seconds between macrod
starting and the first request. The header is the standard SSE one and is not
listed in the OpenAPI spec, and without `resume=true` it is ignored: a browser
`EventSource` reconnecting or an SDK listener gets exactly the live stream it
always got.

The `: keep-alive` comments every 20 s come from the HTTP layer's timer and say
nothing about the event source. So the response also carries
`x-macro-stream-heartbeat: 20`, and every 20 s the stream sends `event:
heartbeat` with data `{}` and no `id`, but only while the process's Kafka
consumer is making progress by its librdkafka statistics
(`kafka_util::progress`): a sample from the last 30 s (samples arrive only while
the consumer is polled), every assigned partition's broker connected, and each
partition caught up or advancing. A heartbeat reaches every open stream
whatever its filters, after the events already queued for it, and is never
replayed. A client that misses three heartbeats in a row, hearing no event
either, can reconnect and resume; macrod does after 70 s, and only when the
header is present, so it never reconnects in a loop to an older server. SDK
listeners skip the heartbeat, which has no `event_type`.

A resuming stream (`resume=true` with a readable `Last-Event-ID`) that falls
more than 1,024 events behind its process's feed ends rather than skipping what
it missed, so its client reopens it and replays them from the retained events.
Any other stream skips them and continues, as before: its client could not
replay them, and the SDK's listener does not reopen a stream that ends.

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
`macro.documents`, `macro.channels`, `macro.messages`, and `macro.webhooks`
topics. Consumers must
therefore treat the order as observed order, not total event order.

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

## MCP Events subscriptions

The Macro MCP server implements the MCP Events extension
(`io.modelcontextprotocol/events`): an agent asks for Macro events, in
plain words or as a webhook event name, and receives them at its own callback
URL. This crate stores those subscriptions, matches events to them and
delivers; the MCP server (`agent_harness_service`) compiles the filter and
encrypts the secret before calling it.

- **Storage.** `mcp_event_subscription`, one row per (user, endpoint URL,
  event type, canonical arguments). The MCP subscription id (`sub_…`) is a
  digest of that key, so subscribing again refreshes the row in place: a new
  expiry, secret and delivery profile, the same filter. Rows expire (`expires_at`; default 1 h,
  1 min to 24 h) and are deleted outright on unsubscribe. Expired rows stop
  matching at once and are deleted by `McpSubscriptionSweeper`, which
  `document_storage_service` runs every minute (batches of 500, the limit
  written into the SQL so a generic plan stops at it, at most 20 per round,
  `FOR UPDATE SKIP LOCKED` so replicas share it). A user holds at most 50 live
  rows: subscribe takes a per-user advisory lock, then counts and
  writes in one transaction, so concurrent subscribes cannot pass the quota
  together. Arguments and filters are each capped at 4 KiB of JSON.
- **Match index.** `mcp_event_subscription_event` holds one row per
  (subscription, event name), carrying the owner and the expiry, rewritten
  with the filter and the expiry. Fan-out reads its `(user_id, event_name,
  expires_at)` index for the event's audience and name, so an expired row
  waiting for the sweep is never read, in chunks of 100 users (at most 5,000
  candidates and 20 MiB of filters per query), fetching only each candidate's
  id, owner and filter, under a 5 s statement timeout. Its foreign key is
  the subscription's `(id, user_id)`, not `"User"`, so writes take no lock on
  the user row and a renamed user id cascades through both tables. The
  subscription id and the secret's KMS binding keep the old user id, so a
  renamed user's subscriptions stop delivering (decryption fails, five
  attempts) until they expire; nothing in production renames users. The quota
  count and the endpoint check read the `(user_id, expires_at)` index, so a
  backlog of expired rows costs them nothing.
- **Live subscribers.** Most events reach no subscriber, so fan-out first
  narrows the audience to the users with a live subscription, held in memory
  by `McpLiveSubscribers`; an audience with none costs no query.
  `document_storage_service` reloads the set every 2 s in each replica with
  one index-only read of the live end of the `(expires_at) INCLUDE (user_id)`
  index. A new subscription is matched from the first reload that starts after it
  commits, in each replica, so its events until then (up to 2 s plus that
  reload's time) pass unmatched. When a reload fails the replica forgets the
  set, and past 10,000 live subscriptions, or when the set is 5 s old because a
  reload hangs, fan-out matches every audience member by query instead.
- **Filter.** `domain/mcp/filter.rs`: an OR of clauses, each exact event
  names, optional parent ids (the webhook `ids` semantics) and an AND of
  conditions on whitelisted message fields (`parent_type`, `parent_id`,
  `actor`, `mentioned_type`, `mentioned_id`), where a value is literal text or
  `me` (the subscriber). The MCP server compiles it from words, shows it to the
  caller and stores only the filter the caller confirms, which delivery
  evaluates deterministically; a request that does not fit is refused,
  never approximated. `stream_groups` splits it for the live stream, which
  applies `ids` itself but does not report an event's parent id: one stream per
  distinct `ids`, matched without them.
- **Access.** Fan-out receives the audience ingestion already computed for
  the event (the users who can see it, as webhook workspaces) and only rows of
  those users can match, so a subscription never sees more than its user's
  webhooks would. A user who loses access stops receiving at the next event.
- **Verification.** A new endpoint must echo a signed
  `{"type":"verification","challenge"}` within the call; a user's live
  subscription to the same URL counts as already verified. Failures map to
  the spec's `CallbackEndpointError` reasons.
- **Delivery.** Fan-out queues one message per matched row on the webhook FIFO
  queue, 16 sends at a time (group `mcp:<row id>`, dedup
  `mcp:<row id>:<event id>`). Ingestion runs it after queueing the event's
  webhooks and tries it three times within 30 s; a fan-out that still fails
  or runs out of time is dropped
  for that event with an error log, so it never fails ingestion or queues the
  webhooks again. The webhook
  worker tells the two message kinds apart by shape. Each POST is a Standard
  Webhooks signed `{eventId, name, timestamp, data, cursor: null}` with
  `X-MCP-Subscription-Id`, `data` being the envelope webhooks deliver. A `chatgpt`
  body over 256 KiB (ChatGPT's limit) is dropped with a warning; `mcp`
  bodies have no cap here. Attempts follow the
  webhook retry schedule, counted by SQS's receive count (5 attempts; a later receipt is acknowledged
  without a POST). A receipt that fails inside this service (the database or
  KMS) counts too, since nothing is stored per delivery: an outage longer than
  the five receipts (about two minutes) drops the deliveries
  waiting on it; `410` and
  `413` are not retried and leave the subscription alone. Nothing is recorded
  per delivery: a row that is gone by delivery time drops the event. Each
  message carries the W3C context of the send that queued it as the SQS
  message attributes `traceparent` and `tracestate`, outside the body, so a
  worker that does not read them still parses it. Every attempt
  (`mcp_events.receive` and `mcp_events.deliver`) joins the trace of the
  ingested event.
- **Secret.** The client supplies the `whsec_` secret. The MCP server
  encrypts it with its KMS key (purpose `mcp-event-subscription-secret`,
  bound to the user); this service only decrypts it: per delivery, and on a
  refresh to tell whether the secret changed. A refresh with a new secret
  keeps the old one in `previous_secret_*` for 10 minutes
  (`SECRET_ROTATION_WINDOW`), and deliveries in that window carry both
  signatures (space-separated in `webhook-signature`), so a receiver still
  holding the old secret accepts them. A stored secret that cannot be
  decrypted fails the refresh, which the client retries. Which secret is
  kept depends on the row as read, so the upsert writes only over a row
  that still holds the secret it read (`read_secret`); after a concurrent
  refresh it reads the row again (up to three times).
- **Delivery profiles.** `delivery_profile` says whose conventions a row's
  deliveries follow; the subscribe body names it (`profile`, left out for
  the default). `mcp`, the default, follows the MCP Events specification:
  `webhook-id` is the delivery's `msg_…` id and `eventId` the event's.
  `chatgpt` is set by the MCP server for ChatGPT, whose integration follows
  an earlier draft: `eventId` equals `webhook-id` (the event's own id stays
  in `data.event_id`), and `data` names no person: every `macro|<email>`
  user id and email address in its keys and string values becomes `me` (the
  subscriber) or `someone`, and so does a `<who>_name` beside a user id
  in `<who>_id` (`requester_name`) (`McpEventOccurrence::new`,
  `without_people`), as ChatGPT's tools never show people's emails. The
  subscribe result names the profile stored, so a caller can tell storage
  that predates profiles (and ignored it) from one that stored it.
- **Stream mode.** `events/stream` stores nothing here: the MCP server reads
  this service's live event stream (`GET /webhook/events/stream`, scope
  `user`) as the subscriber, one connection per `stream_groups` entry, and
  matches each event against the filter itself, so access is the stream's
  per-event check.
- **Internal calls.** `inbound/mcp_router.rs`, nested under `/internal` in
  `document_storage_service`: `PUT /mcp/event_subscriptions` and
  `POST /mcp/event_subscriptions/unsubscribe`, internal key plus acting user.
  Every subscribe carries its filter, which the MCP server derives from the
  arguments (a `macro.events` filter is one the caller confirmed and sent
  back), so a refresh sends the same one.
- **Rolling deploys.** The subscribe body carries `profile` only when it is
  `chatgpt`, and the internal route refuses unknown fields, so roll this
  service out before the MCP server sends ChatGPT subscriptions. A worker from before this change acknowledges an MCP
  queue message as malformed and deletes it. Rows are created only through the
  internal subscribe call, whose one caller is the MCP server, so roll this
  service out to every task before the MCP server: until a row exists, fan-out
  queues nothing. Rolling this service back loses MCP deliveries queued while
  old and new tasks overlap, including ones the remaining new tasks publish
  during it; ordinary webhook messages are unaffected.
- **ChatGPT rollout and rollback.** Roll out this service (with the
  migration), then the MCP server, then `mcp-chatgpt-worker`. Each hop
  refuses an answer from a server too old to know the profile: the MCP
  server checks the profile the subscribe result names, and the Worker
  checks the `com.macro/eventsProfile` the MCP server puts in `_meta`, so
  a version skew fails ChatGPT's subscribe instead of storing a row that
  delivers unredacted. A worker from before profiles reads every row as
  `mcp`, so before rolling this service back past this change, remove the
  ChatGPT rows first (`DELETE FROM mcp_event_subscription WHERE
  delivery_profile = 'chatgpt'`; their queued deliveries then find no row
  and are dropped, and ChatGPT's next refresh fails until the roll forward).
  Rolling back only the MCP server or the Worker leaves stored rows
  delivering correctly and makes ChatGPT's refreshes fail, so its
  subscriptions lapse at `refreshBefore`.

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

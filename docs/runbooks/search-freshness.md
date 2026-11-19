# Search freshness

Runbook for the search indexer monitors in
[`monitors/search-freshness.ts`](../../infra/stacks/monitoring/monitors/search-freshness.ts).
They post to the Alerts channel and never page. The Search freshness dashboard
graphs each one; its header lists the metrics they read.

The target: 99% of live changes searchable within 60 s per entity type, and
99.9% within 5 minutes, over 7 days. A change that never reaches search counts
as a miss. These monitors watch the indexer's backlog and losses. They do not
measure search end to end.

Start every investigation on the dashboard:

- **Partitions furthest behind now** shows where the backlog is.
- **Events processed by outcome** shows whether the indexer is moving at all.

Then check the `kafka.process` spans of `search-processing-service` in APM
(the topic is `messaging.destination.name`) and their `process_event`
children, which carry `partition`, `offset`, `event_type`, `entity_id` and
`outcome`.

## Live backlog

The oldest unindexed change of a non-email entity type has been older than
60 s for five minutes (warning: 30 s). The age is measured from the event's
Kafka timestamp, so it includes time the event waited behind others.

- **Processing has stopped** (the outcome panel is flat): the consumer is
  stalled.
  - Check `aws.ecs.service.running` for the service and the
    `kafka.consumer_stop` spans for restarts.
  - Check OpenSearch health (the [OpenSearch monitors](../../infra/stacks/monitoring/monitors/opensearch.ts),
    CPU, rejected writes). A slow or failing OpenSearch holds every worker.
- **Processing continues**: the live topics are waiting behind other work on
  the same consumer.
  - Look for an email backlog or a reindex running at the same time.
  - Look for one key, such as a busy agent session or document, that fills its
    worker.
- **Levers**:
  - Add tasks to the service. Autoscaling already adds them on a backlog, up
    to its ceiling (see [Adding tasks](#adding-tasks)). More tasks help only
    while OpenSearch has CPU headroom.
  - Pause the bulk work that competes with the live topics, then let the
    backlog drain.

## Email backlog

The oldest unindexed email event on a partition has been older than 24 h for
15 minutes (warning: 6 h). Mailbox imports and reindexes share each mailbox's
partition with its live mail, so new mail on that partition waits behind them.

- The **Email events published by event type** panel separates import traffic
  (`email.thread_backfilled`, `email.threads_reindex_requested`) from live mail.
  A rise in import traffic usually explains the backlog.
- Levers:
  - Add tasks to the service while OpenSearch has headroom
    ([Adding tasks](#adding-tasks)).
  - Slow or pause the imports behind the backlog.
- Watch the [retention monitors](#retention). The backlog becomes data loss
  when it outlives the topic's retention.

## Adding tasks

The service scales on its backlog as well as CPU: each task publishes its
oldest pending age per lane (`live`, `email`) to CloudWatch as
`Macro/SearchProcessing` `OldestPendingSeconds`, and target tracking adds tasks
while either lane is over its target (30 s live, 60 s email). A backlog in
either lane also blocks scale-in. The floor and ceiling are `MIN_TASKS` and
`maxCapacity` in
[`infra/stacks/search-processing-service/service.ts`](../../infra/stacks/search-processing-service/service.ts);
raise them there (a deploy of that stack) to add more. Every topic has six
partitions, so a seventh task gets no Kafka partition and adds no Kafka
throughput; it runs only SQS backfill and replay work.

## Retention

The oldest unindexed event is within about a day of the topic's retention: 10
days for `macro.email` in prod, 7 days for the other topics. Past retention,
Kafka deletes the events the consumer has not read. The consumer then resets to
the newest event and fires [the offset reset monitor](#offset-reset).

- Act now; this is the last warning before a loss.
- Levers, fastest first:
  1. Raise the topic's `retention.ms` in
     [`infra/stacks/kafka-cluster/topics.ts`](../../infra/stacks/kafka-cluster/topics.ts)
     (needs a deploy of that stack, and disk on the brokers).
  2. Add tasks while OpenSearch has headroom.
  3. Accept the loss and plan a reconciliation (below). Note the time range of
     the events that will be lost.
- Update the retention monitors' thresholds whenever the topic's retention
  changes; they repeat it by hand.

## Dropped events

The indexer committed events in the last 15 minutes that never reached the
index. Each one is a change missing from search until that entity is indexed
again. The tags say how it was lost:

- **With `event_type`**: processing failed on every attempt and the event's
  replay from the search event queue failed too, or could not be queued.
  `failure` is the last attempt's cause: `bulk_items` (OpenSearch rejected some
  of the event's documents; `search.index.failed_bulk_items` counts them),
  `overloaded` (OpenSearch kept refusing writes), `source_missing` (a row the
  event needs was missing) or `error`. With `delivery:sqs_replay` the message
  is in the `search-event-queue-dlq` dead-letter queue. The `process_event`
  span with `outcome:dropped` has the entity id and the error.
- **`undecodable`**: the record did not parse. A producer published a shape
  the indexer does not know; check recent deploys of that topic's producer.
- **`cut_off_at_stop`, `not_rewound`, `rewind_unconfirmed`,
  `queued_without_rewind`**: a consumer stopped with events in hand. The
  `kafka.consumer_stop` span lists them as `topic/partition@offset`.

Recovery: reindex the affected entities by id with the backfill routes (below).

## Offset reset

librdkafka reset a partition's position after an error. Usually the position
was older than the topic's retention, and librdkafka moved the consumer to the
newest event. Every event between the old position and the new one was
skipped; nothing replays them, so they must be reconciled from the source.
Resets that keep coming without the consumer falling behind mean librdkafka's
offset queries fail for that partition: check the broker and the consumer's
permissions instead.

1. Find the window. The reset happened at the alert time. The skipped events
   were published from the age of the oldest pending event just before the
   reset (the retention graph) until the reset.
2. Reconcile from the source for that topic's entities, using the time window
   where the route accepts one (see below).
3. Deletions in the window are mostly not recovered by a backfill: a scan of
   the source cannot find rows that no longer exist, so the deleted items stay
   in the index. List the entities deleted in the window from the source
   database and remove them by id (documents:
   `DELETE /internal/delete/{document_id}`; agent sessions requested by id are
   removed when their source row is gone).

## No readings

No indexer task has reported a backlog reading for 10 minutes. Either the
consumer is down, or its metrics do not reach Datadog. In both cases its lag is
unknown, not zero.

- Check `aws.ecs.service.running` and the task stop reasons.
- Check for the consumer supervisor's "event consumer failed" or
  "panicked" logs.
- If the tasks run and process events (APM still shows `process_event` spans),
  the metrics export is broken: check the Datadog agent sidecar.

## Reconciling from the source

The indexer's backfill routes reread an entity's current state from its source
and index it. They are listed in the
[service README](../../services/search_processing_service/README.md#backfill-http-routes)
and take `x-internal-auth-key`.

| Topic | Route | Narrowing |
| --- | --- | --- |
| `macro.email` | `POST /internal/backfill/emails` | `thread_ids`, `since` |
| `macro.documents` | `POST /internal/backfill/documents` | `updated_after`, `updated_before` |
| `macro.chats` | `POST /internal/backfill/chats` | `chat_ids`, `user_ids`, `updated_after`, `updated_before` |
| `macro.channels`, `macro.messages` | `POST /internal/backfill/channels` | `channel_ids` |
| `macro.calls` | `POST /internal/backfill/calls` | `call_ids`, `started_after`, `started_before` |
| `macro.agent_session_lifecycle` | `POST /internal/backfill/agent-sessions` | `agent_session_ids` |
| `macro.projects` | `POST /internal/backfill/projects` | `updated_after`, `updated_before` |
| `macro.calendar` | `POST /internal/backfill/calendar-events` | `updated_after`, `updated_before` |
| `macro.properties` | `POST /internal/backfill/properties` | `entity_type` |

- The time filters read the source's last-update time, so a window catches
  rows changed in it. A route without one rereads everything in scope;
  narrow it with ids from the source database.
- Deletions are not in the source any more, so only an agent-session backfill
  by id finds them (see [Offset reset](#offset-reset)).
- Poll `GET /internal/backfill/{job_id}` until the job finishes, then search for
  a few of the entities to confirm.

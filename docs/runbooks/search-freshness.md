# Search freshness

Runbook for the search indexer monitors in
[`monitors/search-freshness.ts`](../../infra/stacks/monitoring/monitors/search-freshness.ts).
They post to the Alerts channel and never page. The Search freshness dashboard
graphs each one; its header lists the metrics they read.

The target: 99% of live changes searchable within 60 s per entity type, and
99.9% within 5 minutes, over 7 days. A change that never reaches search counts
as a miss. Most of these monitors watch the indexer's backlog and losses. The
probe monitors measure search end to end: the
[freshness probe](../../services/search_freshness_probe/AGENTS.md) writes a
random word into an entity of its own user through the public API once a
minute per entity type, then searches for it the way a client does.

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

- **Processing has stopped** (the outcome panel is flat for the live entity
  types, everything but email): the live lane's consumer is stalled.
  - Check `aws.ecs.service.running` for the service and the
    `kafka.consumer_stop` spans (`lane:live`) for restarts.
  - Check OpenSearch health (the [OpenSearch monitors](../../infra/stacks/monitoring/monitors/opensearch.ts),
    CPU, rejected writes). A slow or failing OpenSearch holds every worker.
- **Processing continues**: the live topics are waiting behind other work in
  their lane. Email has a lane of its own, so an email backlog is not the
  cause.
  - Look for a backlog on one live topic, such as a document reindex.
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

The oldest unindexed event is within about a day of the topic's retention: 7
days for every topic. Past retention,
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

## Failed bulk items

For 30 minutes, OpenSearch has failed items of one entity type's bulk index
writes in every 5 minutes. The events behind them are queued for a replay,
and if that fails too they are dropped (see [Dropped events](#dropped-events)).
Until a write succeeds, those changes are missing from search. Only bulk
writes report failed items: documents, email messages, call segments and
chat repair. Single-document writes (channel messages, projects, calendar
events, properties) and a refusal of a whole request count none; the
backlog and dropped-events monitors catch those. `failure` says why:

- **`overloaded`**: OpenSearch refused items inside the bulk response to
  protect itself (a 429 per item, usually a full write queue). A bulk load,
  such as a mailbox import drain, can do this. Check the domain's write
  rejections and JVM pressure (`aws.es.threadpool_write_rejected`,
  `aws.es.jvmmemory_pressure`) and whether a backfill is running, and slow or
  pause it. A short burst the replays absorb does not reach this alert.
- **`bulk_items`**: OpenSearch accepted the request but failed the items:
  usually a document the mapping rejects, or a write to an index that does
  not exist. The `process_event` spans with `failed_items` above 0 carry the
  entity id and the error; the same documents fail on every replay until the
  code or the mapping is fixed.

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

No indexer task has reported a backlog reading for one lane, the live topics
or `macro.email`, for 10 minutes. Each task reads the two lanes on separate
consumers, so one lane can stop while the other runs. Either that lane's
consumer is down, or its metrics do not reach Datadog. In both cases its lag is
unknown, not zero.

- Check `aws.ecs.service.running` and the task stop reasons.
- Check for the consumer supervisor's "event consumer failed" or
  "panicked" logs, whose `lane` field names the lane.
- If the tasks run and the quiet lane still processes events (APM shows
  `process_event` spans with `entity_type:email` for the email lane, any other
  `entity_type` for the live lane), the metrics export is broken: check the
  Datadog agent sidecar. The other lane's spans say nothing about this one.

## Probe late

Three or more of one entity type's rounds in 15 minutes ended `late`: search
showed the change, but more than 60 s after the API acknowledged the write.
Deletes are practically never late: search hides a deleted entity through its
database check at once, whatever the index still holds. Compare **Seconds until
search showed a probe change** with the indexer's lag for the same type on the
dashboard:

- **The indexer's lag is high too**: the change waits in the indexer; follow
  [Live backlog](#live-backlog).
- **The indexer's lag is low**: the time goes before the event reaches Kafka
  (a slow producer, or for a document body the sync service saving its
  snapshot) or after indexing (OpenSearch refresh, or the search path itself). Open a slow `search.freshness_probe` span: its
  `search.freshness_probe.request` children carry the trace into DSS.

## Probe unseen

Search still did not show a probe change five minutes after the write, twice
in 30 minutes. This is a freshness miss, not a slow one: the event was lost,
dropped, or indexed wrongly, or search no longer finds the entity.

- Check [Dropped events](#dropped-events) and `event_broker.publishes` for
  failed publishes of that type.
- Find the round's span (`search.freshness_probe`, `outcome:unseen`) for the
  `entity_id`, and search for it in the app as the probe user. A delete that
  stays visible means the entity still exists in its source: search hides
  deleted entities by checking the database, not the index.

## Probe prefix unseen

The probe's `crowded_prefix` round missed twice in 30 minutes. Each round
writes a new private document holding one word that sorts late under `con`
(`con`, `zz`, then random letters) and searches `con` alone as a partial
content match, narrowed to that document. The next round deletes it, so it is
gone by the time the alert arrives.

- First check the document rounds (`entity_type:document`, other operations)
  on the dashboard. If they miss too, documents are not reaching the index:
  follow [Probe unseen](#probe-unseen).
- If they pass, suspect content prefix search, but check that the missed
  documents reached the index too: the round's span names the `entity_id`;
  look for its `process_event` spans in `search-processing-service`. A likely
  cause is a prefix query that expands only the first few hundred words of a
  shard starting with the prefix, before permission filtering, as
  `match_phrase_prefix` with `max_expansions` 256 did; the probe's word sorts
  after them. Check how `crates/opensearch_client/src/search/query.rs`
  (`child_content_query`) builds content prefixes, and what deployed last.
- To reproduce, as any user: create a private document whose body is one word
  `conzz` plus random letters, wait until an exact search finds that word,
  then search `con` as a partial content match narrowed to that document
  (`filters.document_filters.document_ids`), as the probe does, so other
  documents matching `con` cannot push it off the page. Missing it while the
  exact search finds it is the bug users see: short prefixes miss results.

## Probe failing

More than half of one kind of round (entity type and operation) in 15 minutes
failed to write or to search. Freshness of that kind is not measured
meanwhile.

- Other write failures: the `search.freshness_probe.request` span names the
  route and status. A 401 means the probe user's key was revoked.
- `search_failed`: searches failed for 30 s in a row, so `POST /dss/search`
  is failing for users too.

A type whose fixture is not seeded yet reports `fixture_missing` every round:
nothing was probed, and no monitor counts it. The probe creates its agent
session itself; a call record is seeded by hand (see the probe's AGENTS.md).

## Probe silent

The probe finished no round of a type for 10 minutes: it is down, stuck, or
its metrics do not reach Datadog. Check `aws.ecs.service.running` for
`search-freshness-probe` and its logs.

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

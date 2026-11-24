# Search Processing Service

This service owns the search-event pipeline:

- **Live calls**: the `search-processing-service` Kafka consumer reads call lifecycle events from `macro.calls` and indexes them into OpenSearch.
- **Agent sessions**: the same consumer subscribes to `macro.agent_session_lifecycle`, rereads the primary database, and indexes messages produced by `agent_fold`. User prompts and agent replies are searchable as a collapsed transcript shows them (`FoldedMessage::searchable_text`): thoughts and the work inside tool calls are not indexed, and raw ACP envelopes never are. Links and mentions in that text are indexed as `mention_utils`' `PlainTextFormatter` writes them (over its lenient parse, as agent notifications do), and a paste or quoted reply as its content; from a `<m-*>` tag that does not parse, the text up to the next paste is indexed as written. Changing what is indexed takes effect for a session on its next reconcile; `POST /internal/backfill/agent-sessions` with `{}` brings every session up to date. Agent-session backfills use this same direct indexing path, not SQS.
- **Database rows**: the consumer subscribes to `macro.databases` and keeps the `database_rows` index (one document per row) in step with Postgres; see "Database rows" below.
- **Other live entities**: Kafka handlers and legacy SQS workers drain events for the remaining search entities.
- **Backfills**: internal HTTP endpoints start tracked jobs. Most enqueue records onto SQS; agent sessions, properties, and the email attachment status index directly.

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

### Database rows

`database.*` events from `macro.databases` (live lane, keyed by database) are hints to reread: each pass reads the primary database through `crates/database_row_search`, whose `read_row_search_text` is also what search re-checks a hit against, so the index and the exposure gate share one definition of a row's text.

- `database.tables_changed` catches up the named tables; `created`, `trashed`, `restored` and `purged` reconcile every table of the database. A database that is gone, trashed or has no database entity (CRM and forms storage) has its documents removed (each by id at its own version) and its watermarks forgotten. Renames, sharing and appearance change nothing indexed.
- A table is caught up from its change journal (`database_change_rows`) between its watermark (`database_row_search_watermarks`, the version the index holds it at) and its current version. A missing or more than 200 versions old watermark, a gap in the journal, or a column change that rewrites rows' text without naming them (type change, deleted or reordered column, relabelled or removed option) reindexes the table whole, then removes the table's documents below the version read at the start. The watermark is raised only after every write succeeded, so a failed pass is redone from the old mark through the replay queue.
- Every write and delete carries the table version its text was read at as an `external_gte` version, so a delayed or replayed pass never overwrites a newer state; a refused write counts as done.
- Paths that publish no event (a tag set's option relabelled outside a database, writes that bypass the databases service) are covered by the backfill route. Every task runs a stale sweep every six hours, led by one task at a time through a Postgres advisory lock: it pages the index and removes documents whose rows are gone or no longer searchable, and the documents and watermarks of tables that are gone.
- Search never trusts the index for access or text: it authorizes and rebuilds every hit from Postgres. A stale document can cost a missed hit, never a leaked one.

Before the first deploy, create the index and alias in each environment (`INDEX=database_rows` with `scripts/create_indices.ts`, see "Agent-session indexing and rollout"), then run the backfill.

### Agent-session indexing and rollout

There is no agent-session indexing feature flag. The deployed search-processing
binary subscribes to the existing `macro.agent_session_lifecycle` topic. Events
are invalidation hints: every reconcile rereads current metadata and the effective
ACP log through the owning agent-session/fold services, and an event that arrives
while a reconcile for its session is still queued is covered by that reconcile
(see the Kafka delivery contract). It never indexes the
event's excerpt as a substitute for the transcript. Completed turns, questions,
renames, and deletions therefore converge on current persisted state. Three
kinds change nothing search reads and are committed without a handoff, before
they could take a session's reread claim: `settled`, `mentioned`, and
`command_rejected` (`changes_search_projection`).

Live events and backfills hold the same per-session PostgreSQL advisory lease
through the OpenSearch write. Lease connections have their own pool so waiting
workers cannot exhaust the pool used to load snapshots. The parent keeps a
record of a content hash per message child (`indexed_messages`, in `_source`
only), read back in real time on each reconcile. A reconcile writes only the
children whose hash changed and deletes recorded children the session no
longer has by id. Before touching any, it rewrites the parent to name them in
`pending_messages` and drop them from the record; once they succeed it writes
the final record. So a reconcile whose request fails part way leaves the next
one to rewrite or delete exactly those children, whatever their hashes say.
Every write and delete carries an `external_gte` version: the time Postgres
granted the reconcile's session lease, in microseconds. One clock serves every
worker and a session's leases never overlap, so a request that times out and
applies after a later reconcile is refused instead of rolling a child back; the
refused reconcile fails; a live event's retry takes a new lease, and a backfill
stops and is rerun. (A delete's tombstone
keeps its version for the index's `gc_deletes`, 60 s by default. A delayed
write of a deleted child arriving later than that is left to the sweep, and a
delayed parent write of a deleted session can recreate its parent; search never
shows it, because results hydrate from the database, which omits deleted
sessions, and a backfill of that id removes it.) Last, a sweep searches for any
child no record or pending list names and deletes it by id under the same
version. A reconcile
that changes no child writes the parent only when it changed; one that does
writes it twice. Nothing waits for a refresh; writes are
searchable after the index's next scheduled refresh. Missing sessions delete
their entire projection, even when triggered by an older event. The reconcile
span records the trigger (lifecycle kind or `backfill`) and the parent and
messages it wrote, left unchanged, and deleted.

The record lives in an unindexed object: the mapping is `dynamic: false` and
maps `indexed_messages` with `enabled: false`, so its child-id keys never become
fields. The real-time parent read needs the `agent_sessions` alias to point at
exactly one index. A backfill to the alias trusts the record and rewrites only
what it says changed; to rebuild every child, backfill into a fresh index with
`index_override` and move the alias. Live updates and deletes during that
backfill reach only the index behind the alias, so after the move, backfill the
ids of the sessions changed or deleted since it started. Until then a changed
session shows its older projection, and a deleted one's documents sit in the
new index, hidden from results as above.

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

The shared consumer commits on in-memory handoff and replays an event whose
attempts fail from the search event queue; it drops an event only when that
replay cannot be queued or fails on its last delivery (see the Kafka delivery
contract). Monitor dropped-event logs and use this backfill for recovery.
Backfills are not automatically scheduled or started by deployment.

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

- The durable consumer group is `search-processing-service`. Its subscriptions are declared in `src/inbound/kafka_consumer.rs`. Each task runs two members of it, one per lane: `email` reads `macro.email` (`EmailLaneEvent`), and `live` reads every other topic (`LiveLaneEvent`). Each member has its own poll loop, workers, offset ledger, graceful-stop rewind and supervisor restart, and everything below holds per lane. Outside a rebalance an email backlog never delays a document, message or calendar event: the lanes share no queue, channel or worker. Both members commit to the group's offsets, so splitting the lanes neither skipped nor replayed a record. Each topic's partitions are assigned among the members subscribed to it (librdkafka's default `range` assignor). A rebalance still pauses every member of the group until all have rejoined, and an email member rejoins only when its poll loop next reads, once its blocked handoff gets a slot: usually within a second, longer while OpenSearch refuses writes and its workers wait between attempts. A stopping task therefore keeps both members until both lanes have committed back, or 6.5 s after the stop for a lane that is not running (`LeaveTogether`), so the task leaves the group once: a member that left first would hold every task's lanes for the other lane's drain.
- The poll loop shards decoded events by entity ordering key across ten sequential workers, each with a bounded 16-message channel. Sending waits when the selected channel is full, stopping polling and committing until that worker catches up. Agent-session lifecycle events are rereads of the whole session, so while one for a session is queued and not yet started, later ones for that session are committed without a handoff; the worker clears the session as it starts the reread, so an event arriving mid-reread queues the next one. Without this, one session emitting events faster than its roughly two-second reconcile filled its worker's channel and held its whole lane, every topic in it, to that worker's pace. Email thread and message events shard by thread, and a thread reindex request (`email.threads_reindex_requested`) by its first thread, so one mailbox's import spreads across the workers and a thread's reindex stays ordered with that thread's other events; a request for one thread is a reread of that thread and coalesces the same way. A reread covers only the requests queued directly behind it: handing off any other event for its thread (a delete that trusts its own spam flag, say, which a reread run before it cannot undo) releases the claim, so the next request queues again. A request for several threads is never coalesced, and only its first thread's events stay ordered with it. Events for the same entity stay ordered within one consumer, but not end to end: producers can publish them out of order, and a rebalance does not wait for the previous owner's workers, which can still be processing older events while the new owner processes later ones. Handlers must not assume an entity's newest event arrives last.
- A lane's topics reach its poll loop through its member's one librdkafka queue, in the order its fetches return. With librdkafka's defaults that queue held up to 100,000 records, so while email shared it, a document or message waited behind an hour of prefetched email. The group bounds it (`PREFETCH` in `src/inbound/kafka_consumer.rs`, `kafka_util::Prefetch`): a partition is fetched again only once fewer than ten records are queued, at most 8 KiB from it per fetch, so a live record waits behind tens of another live topic's queued records, not tens of thousands. A producer batch larger than 8 KiB is still fetched whole. The bound also limits how fast one partition of quick events (ignored, coalesced or index-irrelevant) drains, to about 1,400 a second at the email topic's record size.
- An offset is committed asynchronously immediately after a successful in-memory handoff, not after OpenSearch processing. This commit-after-handoff design creates a loss window: a process or host crash can lose committed events still in those buffers. If the worker channel closes before handoff, the offset is left uncommitted for redelivery.
- A graceful stop (a scale-in or deploy: SIGTERM) redelivers the events still queued. The consumer stops polling, abandoning a handoff that waits on a full channel, and gives the workers five seconds, half of the ten ECS allows after the stop signal, to finish the record each holds (a record waiting to retry is queued for its replay instead); they start no more, and workers still running are aborted. Each partition it still owns is then committed synchronously back to its first record no worker started, so the partition's next owner redelivers it and everything after it on that partition, including records that did finish. Events a worker had started and did not finish are never the point a partition is committed back to, so an event that hangs or kills its worker is not retried on every stop; one is replayed only when an event queued before it on the same partition is, since a committed offset cannot skip it. Nothing is committed back when a worker panicked during the run, when the stop comes in the middle of a rebalance (the consumer then owns no partitions), or for partitions it lost earlier. A consumer that stops after an error (a worker that died) waits for its workers as before and only logs what it left.
- Malformed, keyless, and unsupported-schema records are logged and committed without handoff so a poison record cannot wedge a partition. Commit failures are logged and may cause duplicate delivery, which is safe because full upserts and per-call deletes are idempotent.
- Removing a disconnected inbox (`email.link_disconnected`) deletes the inbox's email documents as an OpenSearch delete-by-query task (`wait_for_completion=false`, sliced, throttled to 1,000 documents per second, no forced refresh), so the delete holds no worker. At most two run at once, since the throttle is per task. With a slot free, the event finishes once OpenSearch accepts the task, and a failure to start retries the event; otherwise the delete waits for a slot in the background and the event is done. Each task carries `X-Opaque-Id: email-link-delete:<link_id>`, and starting one first adopts a delete already running for that inbox, so a retry, a redelivered event or a start whose response was lost adopts the running task instead of starting another; a second event for an inbox this process already follows is skipped. Listing and starting are separate requests, so two consumers starting the same inbox at once (during a rebalance) can still start two tasks, which delete the same documents. The service follows each task until it ends. A task that fails, skips documents on version conflicts, times out or vanishes is started once more after an index refresh, so the replacement sees what changed; a cancelled one is not. Progress that cannot be read is logged and polling goes on with the delete's slot still taken, for up to 30 minutes; past that the delete is given up and its slot freed, so the two-task limit is best effort while a task stays unreadable. On shutdown the service stops following: started tasks keep running in OpenSearch and nothing follows them again, and deletes still waiting for a slot are not started, which leaves their documents in the index. The inbox's mail is out of search results before the task starts: the email service publishes `email.link_disconnected` only after purging the inbox's rows, and email search drops hits it cannot resolve to a row.
- Processing gets three total attempts, with retries after 1 and 2 seconds (`src/inbound/kafka_consumer/attempts.rs`). While OpenSearch refuses writes (a 429 for a full write queue or a tripped breaker, or a write block), for the whole request or for items inside a `_bulk` it answered 200, an event gets eight attempts with doubling waits of 0.5 to 30 seconds, half of each random: about 45 to 90 seconds in all. The waiting worker holds its channel, so a cluster shedding load also slows polling. A stop cancels the wait. Failed attempts that will be retried log warnings. Within each attempt, `opensearch_client` resends a request whose connection drops before a complete response, and any item OpenSearch fails inside a successful `_bulk` answer fails the attempt.
- An event whose attempts fail, or whose wait a stop cuts off, is queued on the search event queue as a `ReplayBrokerEvent` carrying its original record, invisible for a minute, so a later event can continue. The SQS workers decode it as the consumer did and run the same handler once per delivery. A failed replay is delivered again after the queue's visibility timeout, and after its second delivery it moves to `search-event-queue-dlq`, where it can be inspected and redriven. A replay that still finds a row it needs missing ends as `source_missing` instead. A channel message whose channel is gone ends as `source_missing` on its first attempt, without a replay: a channel is deleted with its messages, and the channel's delete event removes their documents (they carry the channel id as `entity_id`). A missing message in a channel that still exists is retried and replayed like any failure. The event is dropped, logged as an error, only when its replay cannot be queued; a dropped agent-session reconcile or thread reindex also drops the events it absorbed. A replay runs outside the consumer's per-entity ordering: it applies its event after, or at the same time as, a later event for the same entity. The handlers reread the source, except deletes, which a replay applies as they were. A replay, like every queue message, stays hidden while it runs (see "Search event queue workers"). A worker that cannot decode a replay, as a task does during a rolling deploy or after a rollback to a release that predates replays, fails it until it dead-letters; redrive `search-event-queue-dlq` once every task runs a release that reads replays.

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
2. A partition the group has no committed offset for starts at its newest record (`INITIAL_OFFSET = Latest` in `src/inbound/kafka_consumer.rs`, so `auto.offset.reset=latest`): a topic added to the subscriptions is read from its head, not replayed from its retention, and its earlier events need a backfill. The first deployment read `macro.calls` from its earliest offset while live SQS delivery still ran; that replay and the dual delivery were safe because call upserts are full idempotent overwrites and deletes are idempotent delete-by-query operations.
3. Before disabling live SQS call publication, confirm the consumer-group lag on `macro.calls` has caught up, worker errors are healthy, and the `call_records` index is fresh. Continue monitoring lag after cutover.
4. Watch service logs for Kafka receive/decode/commit errors, processing retry warnings, events dropped after three attempts, and consumer supervisor restarts. A commit error can result in a safe duplicate; a dropped processing event or crash in the commit-after-handoff window can require recovery. A stop records a `kafka.consumer_stop` span per lane (`lane`, `leave_wait_ms`, `drain_ms`, `aborted_workers`, `worker_panicked`, `lost`, `rewound_partitions`, `not_rewound`, `unconfirmed`) and logs the partitions committed back for redelivery, queued events on partitions it no longer owned, queued events whose rewind could not be confirmed (check the group's committed offsets before a backfill), and the started events cut off, each as `topic/partition@offset`.
5. Each Kafka record gets a `kafka.process` span (`kafka_util::consumer_span`), parented on the producer's trace when the record carries one. It covers handoff, the wait in the worker channel and processing, and records `macro.event.type`, `macro.event.id` and, for agent sessions, `agent.session.id`; a dropped event marks it failed. Its child `process_event` span covers processing alone and records `partition`, `offset`, `event_type`, `entity_id` (the producer key, except for entity properties, whose key can name a user), `entity_type`, `delivery` (`kafka`, or `sqs_replay` under a replay's `search.replay_event` span), `record_age_ms` (how long after the broker recorded the event processing began), `attempts`, and `outcome`: `indexed`, `ignored` (nothing to index, including a property change on an entity type without a search index), `retry_queued` (its attempts failed and its replay is queued), `failed` (a replay the queue delivers again), `source_missing` (a replay whose row is still missing, or a channel message whose channel is gone), `dropped` (error status: its replay could not be queued, or failed on its last delivery), `no_index_change` (the event changes nothing indexed: known at handoff, or a property write for an entity the index does not hold yet), or `coalesced`, a zero-length span for an event a queued reread covered. An event whose last attempt failed also records `failure` (`bulk_items`, `overloaded`, `source_missing` or `error`) and `failed_items`, the items OpenSearch failed in that attempt's bulk request. `kafka.process` is the service's top-level consumer span, so exact per-topic throughput and error rates come from `trace.Consumer.hits` and `trace.Consumer.errors` grouped by `peer.messaging.destination`. Breakdowns by `@event_type` or `@outcome` come from indexed spans, which are a sample.
6. Each inbox removal gets an `email.mailbox_delete` span that lasts until the service stops following it: the task ended, or the service shut down. It records `link_id`, `task_id`, `restarted_task_id` (the replacement after a restart), `queued_ms` (time spent waiting for a slot, when it waited), `deleted`, `total`, `restarts`, `poll_errors` (progress reads that failed) and `outcome`: `completed`; `canceled`; `unfollowed` when the service shut down while following; and, with error status, `failed`, `unreadable` (progress unreadable for 30 minutes; the task may still run), `not_started` (shut down before the delete or its replacement was sent) or `start_interrupted` (shut down after a start was sent, so OpenSearch may have accepted it). A task no longer followed is the one in `restarted_task_id` when it is set, `task_id` otherwise; read it with `GET _tasks/<id>`, or list `GET _tasks?actions=*byquery&detailed=true` and match `X-Opaque-Id`. After `start_interrupted`, check that list before deleting again; after `not_started`, a delete-by-query on the `link_id` removes the documents.
7. Freshness and losses are OTel metrics (`src/inbound/kafka_consumer/metrics.rs`), unsampled and exported every 60 s, graphed on the Search freshness dashboard (`infra/stacks/monitoring/monitors/search-freshness.ts`), whose monitors post to the Alerts channel (runbook `docs/runbooks/search-freshness.md`). `search.index.lag_ms` is a histogram of the time from the record's Kafka timestamp, set when it was published, to the end of its processing (unlike `record_age_ms`, taken when processing begins), tagged `entity_type`, `event_type`, `outcome` and `delivery` (`kafka`, or `sqs_replay` for a replay, whose lag still counts from the original record); freshness reads `outcome:indexed`, and `retry_queued` marks an event that will be late. `search.index.oldest_pending_ms` reports every 10 s, per assigned `topic` and `partition`, the age of the oldest record not yet processed, 0 when caught up. It reads the consumer's position and cached watermarks rather than processed events, so it keeps rising while the consumer is stalled, when the lag histogram records nothing. `search.index.dropped_events` counts events committed without reaching the index: by `entity_type`, `event_type`, `delivery` and the last attempt's `failure` (`bulk_items`, `overloaded`, `source_missing` or `error`) when dropped after their attempts and replay, or by `failure` (`undecodable`, `cut_off_at_stop`, `not_rewound`, `rewind_unconfirmed`, `queued_without_rewind`) for records lost outside the workers. `search.index.failed_bulk_items` adds the items OpenSearch failed in the last attempt of an event that was queued for a replay or dropped, by `entity_type`, `outcome` and that attempt's `failure` (`overloaded` for items refused inside the bulk response, such as a 429 per item, `bulk_items` for items failed otherwise); a refusal of the whole request reports no items. The service flushes its telemetry on exit, so losses at a stop are exported. Producers count every publish in `event_broker.publishes` (`topic`, wire `event_type`, `outcome`), which separates live email events from imports. Every 60 s each task also publishes the oldest pending age it sees per lane to CloudWatch (`Macro/SearchProcessing` `OldestPendingSeconds`, dimensions `Environment` and `Lane`: `email`, or `live` for every other topic; `src/outbound/cloudwatch_backlog.rs`). A task sends a lane only when it owns a partition in it with a fresh reading. The service's autoscaling tracks the `Maximum` of each lane beside CPU (`infra/stacks/search-processing-service/service.ts`), so a backlog vetoes scale-in.

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

Every search-indexed entity has a POST endpoint on sps's internal surface. They return `202 Accepted` with `{"job_id": "..."}`, share internal-auth via the `x-internal-auth-key` header, and accept a per-entity JSON filter in the request body. Poll `GET /internal/backfill/{job_id}` for status and the `enqueued` progress count; a resumable backfill also reports its `cursor` and update counts. SQS can take a batch and refuse some of its entries; the backfill sends those again, twice at most (never an entry SQS blames on the request), and counts the ones it still refuses as `not_queued`, in messages, not source rows (one email message carries several threads). A job with any is `failed`, cancelled or not, so `completed` means every message reached the search event queue; the warning names up to 10 of the refused ids, so rerun them or the same scope.

| Entity | Route | Body (fields optional unless marked) |
|---|---|---|
| Agent sessions | `POST /internal/backfill/agent-sessions` | `{"agent_session_ids": ["<uuid>"], "index_override": "agent_sessions_v2"}` — `{}` = all existing sessions, indexed directly |
| Calls | `POST /internal/backfill/calls` | `{"call_ids": ["<uuid>"], "started_after": "...", "started_before": "..."}` — empty = all archived calls |
| Chats | `POST /internal/backfill/chats` | `{"chat_ids": [...], "user_ids": [...], "updated_after": "...", "updated_before": "..."}` |
| Channels | `POST /internal/backfill/channels` | `{"channel_ids": ["<uuid>"]}` — `{}` = all channels |
| Projects | `POST /internal/backfill/projects` | `{"updated_after": "...", "updated_before": "..."}` |
| Calendar events | `POST /internal/backfill/calendar-events` | `{"updated_after": "...", "updated_before": "..."}` |
| Properties | `POST /internal/backfill/properties` | `{"entity_type": "..."}` — `entity_type` required |
| Documents | `POST /internal/backfill/documents` | `{"file_types": ["pdf"], "sub_type": "task", "updated_after": "...", "updated_before": "..."}` |
| Emails | `POST /internal/backfill/emails` | `{"thread_ids": ["<uuid>"], "since": "2026-03-16T00:00:00Z", "index_override": "emails_v2", "batch_size": 100}` |
| Email attachment status | `POST /internal/backfill/email-attachment-status` | `{"after_document_id": "<cursor>", "page_size": 500, "docs_per_second": 100}` — `{}` = every document linked to an email attachment, updated directly; see below |
| Database rows | `POST /internal/backfill/database-rows` | `{"database_ids": ["<uuid>"]}` — `{}` = every searchable database reindexed whole, then stale documents removed; indexed directly |
| Deleted chat messages | `POST /internal/backfill/deleted-chat-messages` | `{"dry_run": false, "after_message_id": "<cursor>", "page_size": 500, "messages_per_second": 1000}` — `{}` = a dry run over every indexed chat message; see below |

### Search event queue workers

While a worker processes a message it hides it again every 30 seconds for another 2 minutes, so work that outlasts the queue's 2-minute visibility timeout is not delivered a second time beside it; a message still running after the five-minute processing limit is abandoned and returns when its last extension lapses. On a stop (SIGTERM, as on a deploy or scale-in) the workers take no more messages, hand back at once, together, any they receive as the stop arrives, give the messages they are processing 5 seconds to finish, and then hand those back too, so another task picks them up without waiting out the visibility timeout. A receive still unanswered 4 seconds after the stop is given up on, and what it brings returns after the visibility timeout. Each visibility change gets 3 seconds, and a stalled heartbeat holds up neither the work nor the stop. The task is killed 10 seconds after SIGTERM (`stopTimeout`), and the workers drain beside the Kafka consumer within that.

### Backfill cap and pause

Every backfill in a task shares one cap on the work it has in flight, `BACKFILL_MAX_IN_FLIGHT` (default 20). Each wait is for a single unit, so the semaphore serves the queue workers and the direct backfills in arrival order. An SQS worker waits for one unit, takes whatever else is free up to `QUEUE_MAX_MESSAGES`, receives at most that many messages with a 2-second wait, and gives back the units it got no message for; each message keeps one unit until it is processed. A worker that finds the queue empty holds nothing and asks again after the rest of the queue's long-poll wait, so after a quiet spell the first new message can wait up to about 18 seconds to be picked up. Direct backfills (agent sessions, properties, email attachment status, deleted chat messages) take one unit per write or page. The cap is per task, so the service-wide limit is the cap times the running task count. Everything on the search event queue passes the gate, including the user-profile removals an account deletion sends, the thread batches email-service sends when a Gmail label is renamed (`EmailThreadBatchMessage`, held back a minute so they read the new name) and the replays of live events whose attempts failed; the Kafka consumer itself does not. A pause therefore also holds those batches and replays, which stay on the queue until it lifts.

`PUT /internal/backfill/pause` with `{"paused": true}` pauses every backfill in every task, and `{"paused": false}` resumes them; `GET /internal/backfill/pause` reads the switch. It is one item (`control:backfills`) in the backfill jobs table. A task reads it before it starts its workers (giving up after 5 seconds and starting unpaused) and then 10 seconds after each read (a read that takes over 5 seconds is abandoned and keeps the last state), so a change takes effect within about 15 seconds. While paused, SQS workers take no messages, which wait on the queue (they still expire after its retention, 4 days by default); backfills that enqueue stop between pages; direct backfills wait before their next write; and a cancel or shutdown still ends a paused job. Work already admitted finishes. A paused backfill job still reports `running`. A task that cannot read the switch keeps the state it last read.

### Email attachment status

`is_email_attachment` on a `documents` parent is true exactly when a
`document_email` row links the document to an email attachment. Every full
index writes it, so this backfill is for documents indexed before the field
existed. It walks `document_email` in `document_id` order on the backfill pool
and sets the flag to true on each live (not trashed) document's parent with
partial `_bulk` updates through the `documents` alias. It neither re-extracts
content nor goes through SQS.

Before starting it on an environment:

1. Apply the `is_email_attachment` mapping there (`create_indices.ts` in
   `infra/stacks/opensearch/helpers`) and confirm it with `verify_mappings.ts`.
2. Check disk headroom on every node with `GET _cat/allocation?v`. At the
   flood-stage watermark OpenSearch makes every index read-only, and earlier
   backfills have driven production there.
3. Run one job per environment at a time; the rates of concurrent jobs add up.

The job writes at most `docs_per_second` (default 100) documents a second, in
pages of `page_size` (default 500, at most 1000) distinct linked documents.
The status poll reports `enqueued` (linked documents read), `updated`,
`missing` (not in the index; their first full index writes the flag), `failed`,
and `cursor`, the last document id it finished, recorded after every page.

A 429 or a cluster block from OpenSearch stops the job instead of retrying:
its status becomes `stopped`, `error` holds the reason, and `cursor` the last
finished page. So does a page in which any document failed to update; resuming
repeats that page. Pages are read from the primary, not the backfill replica:
a lagging replica could still show a link that a release already removed, and
the backfill would write `true` after the release cleared it. Once the cluster recovers (for a flood-stage block, once disk is
freed and the block is cleared), resume with
`{"after_document_id": "<cursor>"}`. A failed or cancelled job resumes the same
way. Shutdown cancels a job on its own pod between pages, not on others.

Each update reindexes the whole parent, even when its `_source` already holds
the value, so the backfill also repairs parents written before the mapping
existed. A release that reaches an environment before its mapping therefore
loses nothing permanently: its full writes leave the flag unindexed in
`_source`, the backfill reindexes every attachment's parent, and an unindexed
`false` reads the same as an absent field.

### Deleted chat messages

Deleting one message from a chat used to leave its document in the `chats`
index, where chat search still matches the chat through it, and a backfill
only writes, so it cannot remove them. This job walks the index's message
documents in message id order, looks up their `ChatMessage` rows, and deletes
the documents whose row is gone; a message's row is deleted outright, so a
missing row is a deleted message. Each page is looked up on the backfill
replica, and every message the replica lacks is looked up again on the primary
before it is counted or deleted, so a lagging replica cannot remove a message
just written. Messages of a chat whose row is also gone are removed the same
way; the chat's own document stays, and search drops it since its row is gone.
A message deleted while the job runs may be read as live from a lagging
replica and passed over; its own delete event removes its document.
Database access is primary-key lookups; nothing is written there.

The job is a dry run unless the body says `"dry_run": false`: it reads and
counts, and deletes nothing. Run the dry run first. The job record's entity is
`deleted-chat-messages-dry-run` for a dry run and `deleted-chat-messages` for
a run. The status poll reports
`enqueued` (indexed messages read), `missing` (messages whose row is gone, the
documents a run deletes), `updated` (documents deleted, 0 in a dry run), and
`cursor`, the last message id it finished. Each page's
`search.deleted_chat_messages.page` span also records `gone_with_chat`, how
many of its gone messages belong to a chat whose row is gone too, and
`gone_sample`, up to 10 of them as `chat_id:message_id`. Traces keep few of
these pages, so each page with gone messages also logs one `info` event, "chat
message repair page found messages whose row is gone", with `job_id`,
`dry_run`, `gone`, `gone_with_chat` (absent when the chat lookup failed, which
logs a warning) and `gone_sample`. Check a dry run's finds against
`ChatMessage` from those events before the real run.

It reads at most `messages_per_second` (default 1000) indexed messages a
second, in pages of `page_size` (default 500, at most 1000), and deletes with
routed `_bulk` deletes. A 429 or a cluster block stops it with status
`stopped`, as does a page with any failed delete, and `error` says how many
of the page's deletes failed. A stopped page records nothing, so `cursor` is
the page before it; resume a run with
`{"dry_run": false, "after_message_id": "<cursor>"}`, which repeats that page
(without `dry_run` the resume only counts). Documents the stopped page did
delete are not read again once the index has refreshed, so neither run's
`missing` or `updated` counts them, and a resumed run's counters are not the
total of both runs. A failed or cancelled job
resumes the same way.

### Against dev (deployed service)

The internal routes are behind the gateway: `https://dev-gateway.macro.com/search-processing`
on dev and `https://gateway.macro.com/search-processing` in production
(`SearchProcessingServiceUrl` in `crates/macro_service_urls`). They take the
service's `INTERNAL_API_KEY`, which `doppler run` hands to curl without printing
it:

```bash
doppler run -p search-processing-service -c dev -- sh -c '
  curl -X POST https://dev-gateway.macro.com/search-processing/internal/backfill/calls \
    -H "Content-Type: application/json" \
    -H "x-internal-auth-key: $INTERNAL_API_KEY" \
    -d "{}"'
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

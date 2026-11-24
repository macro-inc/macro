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
  there is a crash-loss window; recovery is the backfill routes. An event
  whose attempts fail is replayed from the search event queue
  (`inbound/kafka_consumer/replay.rs`): a handler must return its error, never
  log and succeed, or the failure is counted as indexed and never replayed.
  A graceful stop commits each partition it still owns back to its first
  record no worker started (`inbound/kafka_consumer/offsets.rs`), so workers
  must report every record they start and finish, once per delivery. Never
  rewind to a started record: one that hangs or kills its worker would then
  be retried on every stop.
- Each lane (`email`, `live`) is its own group member with its own poll loop
  and workers (README "Kafka Delivery Contract"); a topic added to
  `DeclaredMacroEvent` must join one lane's `declare_topics!` too. A stopping
  task's members leave the group together (`LeaveTogether`); one that left
  early would rebalance every task while the other lane drains. A poll loop
  blocks on a full worker channel, so one slow, busy key stalls every topic
  in its lane. `coalescible_reread_key` skips agent-session events and
  one-thread email reindex requests while a reread for that session or thread
  is queued; only add an event kind there if handling it rereads the entity's
  whole current state. Handing off any other event for the key releases its
  claim, since the reread runs before it; keep that, or a blind delete queued
  behind a reread swallows the request that would undo it. Never shard a
  thread event by its mailbox: one mailbox's import then runs on one worker
  and its full channel stalls every topic in its lane.
- A lane's topics share its member's one librdkafka prefetch queue; the
  group's `PREFETCH` bound keeps a live topic from waiting behind another live
  topic's backlog. Throughput comes from the workers, not the prefetch, so
  raising the bound only drains quick events faster, at the cost of that
  wait.
- `changes_search_index` commits events that change nothing indexed before
  any reread claim; an event filtered later, in a worker, would hold the claim
  and absorb a later event that does change something.
- Every outcome goes through `record_outcome`, which also feeds the freshness
  metrics in `inbound/kafka_consumer/metrics.rs`; their names and tags are the
  Search freshness dashboard's contract (README step 7), and their tags are
  closed sets (never an id). `backlog.rs` samples each partition's oldest
  pending record from the ledger and the client's cached watermarks, also while
  the poll loop waits on a full worker channel; a new consumer loop needs its
  own `BacklogSampler`.
- Autoscaling tracks the CloudWatch metric `Macro/SearchProcessing`
  `OldestPendingSeconds` (`Environment`, `Lane`) that `scaling.rs` publishes
  through `outbound/cloudwatch_backlog.rs`; its name, dimensions and lanes are
  the contract with `infra/stacks/search-processing-service/service.ts`, and
  the task role may write only that namespace. A local service only logs it.
- Channel messages and agent-session prompts and replies are indexed through
  `parsers::message_text::with_pastes_as_content`: `mention_utils`'
  formatters drop `<m-paste>` (long pastes; in agent sessions also quoted
  replies) with every tag they do not know, so a new message index writes its
  pastes the same way.
- A thread reindex deletes, and a message upsert skips, every message its
  mailbox facts put in Trash or Junk or mark gone at the provider
  (`ParsedSearchMessage::excluded_from_search`, read from
  `email_message_mailbox_facts`). Never decide that from labels: Outlook
  messages have no system labels, so a label check keeps Outlook trash, junk
  and provider deletes searchable, whether the change came from Macro (an
  organization command) or from Outlook.
- Email documents are keyed `{thread_id}:{message_id}`, so a message that
  changes threads gets a new document and keeps the old one. An
  `email.message_sent` from a Macro send (`origin: UserAction`) deletes the
  message's copies under other threads; a draft that moved and was never sent
  keeps its old copy. A draft transferred to another inbox gets a new message
  id, so this cleanup does not reach its source copy.
- Removing an inbox only starts an OpenSearch delete task and follows it in the
  background (`process/email/mailbox_delete.rs`), at most two at a time; never
  await a whole-inbox delete on a consumer worker. Starting adopts a delete
  already running for the inbox (`X-Opaque-Id`), so a retry or redelivery
  follows that task; list-then-start is not atomic, so a rebalance can still
  start two. A shutdown leaves running tasks unfollowed and drops deletes still
  waiting for a slot; the `email.mailbox_delete` span's `outcome` and task ids
  say which.
- Database rows (`domain/database_row_index.rs`): events are hints; a pass
  reads Postgres through `crates/database_row_search` (the same text rules
  search's exposure gate uses) and raises the table's watermark only after
  every write succeeded. Never index from event payloads, and never raise a
  watermark before the writes for it landed (README "Database rows").
  Trash and restore do not bump the table version, so every pass that reads
  and writes a database's documents or moves its watermarks holds that
  database's advisory lock (`DatabaseRowSource::lock_database`, a
  transaction-scoped lock on its own pool). Only a table that is gone, which
  never comes back, is cleaned up without it. The 15-minute sweep
  (`inbound/database_row_sweep.rs`) is the safety net for lost events and
  tag relabels outside databases; keep it cheap, and keep the whole-index
  scan on its slower cadence.
- Full-scan backfills page by UUID, not `modified_at`, and cannot discover
  already-deleted IDs — target specific IDs for those. Chat messages deleted
  without their delete reaching the index are removed by
  `POST /internal/backfill/deleted-chat-messages`, a dry run unless the body
  sets `"dry_run": false`.
- Every backfill writer passes the task's `BackfillGate`
  (`domain/backfill_gate.rs`): the shared in-flight cap and the operator
  pause (`PUT /internal/backfill/pause`). A new backfill path takes a permit
  per write, or per received batch for queue workers; never gate the live
  Kafka path, whose `reconcile` the agent-session backfill shares, so gate
  the backfill loop, not the shared function.
- Run `POST /internal/backfill/email-attachment-status` on an environment only
  after the `is_email_attachment` mapping is applied there, and check
  `_cat/allocation` disk headroom first. It is throttled (`docs_per_second`,
  default 100), stops on a 429 or cluster block with status `stopped`, and
  resumes with `after_document_id` set to the job's `cursor`. Each update
  reindexes the parent, so it also repairs documents written before the
  mapping existed (README "Email attachment status").
- `is_email_attachment` is written on every full parent index, from
  `document_email`, and turned off by `document.email_attachments_released`
  (one bulk update for the batch's trashed and kept documents). A full index
  that read the link just before the release and lands after it leaves the
  parent true until its next full index.

## Related

- Docs: this directory's `README.md` · Rules: `.agents/rules/rust/architecture.md`

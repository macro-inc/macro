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
  A graceful stop commits each partition it still owns back to its first
  record no worker started (`inbound/kafka_consumer/offsets.rs`), so workers
  must report every record they start and finish, once per delivery. Never
  rewind to a started record: one that hangs or kills its worker would then
  be retried on every stop.
- The poll loop blocks on a full worker channel, so one slow, busy key stalls
  every topic. `coalescible_reread_key` skips agent-session events while a
  reread for that session is queued; only add an event kind there if handling
  it rereads the entity's whole current state.
- Every topic shares librdkafka's one prefetch queue; the group's `PREFETCH`
  bound keeps other topics from waiting behind an email backlog (README "Kafka
  Delivery Contract"). Email throughput comes from the workers, not the
  prefetch, so raising the bound only drains quick events faster, at the cost
  of that wait.
- `changes_search_index` commits events that change nothing indexed before
  any reread claim; an event filtered later, in a worker, would hold the claim
  and absorb a later event that does change something.
- Channel messages and agent-session prompts and replies are indexed through
  `parsers::message_text::with_pastes_as_content`: `mention_utils`'
  formatters drop `<m-paste>` (long pastes; in agent sessions also quoted
  replies) with every tag they do not know, so a new message index writes its
  pastes the same way.
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
- Full-scan backfills page by UUID, not `modified_at`, and cannot discover
  already-deleted IDs — target specific IDs for those.
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

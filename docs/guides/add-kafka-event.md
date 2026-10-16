# Adding a Kafka event

An event touches more than its producer: the topic registry, every composition
root that builds the producing service, and every consumer already subscribed to
the topic. Several of those consumers drop what they don't recognize without
failing, so a missed step looks like a healthy publish and no effect. Each
section below is one place, in order; past misses are called out inline.

> **Agents never deploy.** Topic creation in MSK happens when the
> `kafka-cluster` stack deploys. See the
> [infrastructure guide](../development/infrastructure.md).

## Pick a model to copy

| Adding | Copy | Why |
| --- | --- | --- |
| A topic | The `macro.messages` registration: `crates/macro_event_topics/src/lib.rs`, its `test.rs`, `.github/kafka-cluster-topics.json` | Three files, shipped as its own PR ahead of the producer |
| Events on a topic | `crates/github_pull_requests/src/broker.rs` (one variant), `crates/messages/src/outbound/broker.rs` (several) | Topic enum, keyed envelope, broker-backed adapter for a domain port |
| A durable consumer | `crates/crm/src/inbound/call_archived.rs` | Smallest grouped consumer: poison commit, bounded retry, commit after work, cancel-safe |
| An at-least-once consumer that must not skip | `crates/webhook/src/inbound/kafka_consumer.rs` | Transient vs permanent errors; exits uncommitted so a restart redelivers |
| A per-process fan-out (GraphQL subscription, SSE) | `crates/agent_session_realtime/src/outbound/log_topic_consumer.rs` | Ungrouped, starts at `Latest`, commits nothing |

Background: `crates/macro_event_broker/AGENTS.md` maps the broker crate;
`crates/properties/README.md` ("Delivery semantics and compatibility") states the
delivery contract every producer has.

## 1. Register the topic (new topics only)

Add a variant to an existing topic when the event is about the same entity as
the topic's other events; add a topic only for a new entity stream.

- Add `MacroXTopic => "macro.<snake_plural>"` with a doc comment to `topics!` in
  `crates/macro_event_topics/src/lib.rs`, and an assertion to
  `all_topic_names_includes_declared_topics` in `src/test.rs`.
- Run `cargo x kafka-topics` and commit `.github/kafka-cluster-topics.json`. Never
  hand-edit it. CI (`check_generated`) fails when it is stale, and the
  `kafka-cluster` stack creates MSK topics only from this file.
- Ship the registration as its own PR, merged before the producer. A producer
  that starts before its topic exists loses events: publication is
  fire-and-forget and the request still succeeds.
- Locally the broker auto-creates unknown topics with **one** partition, so a
  missing registration still "works" on your machine. Don't treat a local
  publish as proof the topic is registered.

## 2. Define the event (producing crate)

Put the types next to the domain that owns the fact
(`src/domain/events.rs` or `src/broker.rs`):

- A topic enum with `#[serde(tag = "event_type", content = "metadata")]` and
  `#[serde(rename = "<entity>.<past_tense>")]` per variant, implementing
  `TopicEvent { type Topic; const SCHEMA_VERSION: u8 }`.
- A `XMacroEvent { key, event: Event<XTopicEvent> }` implementing `MacroEvent`,
  with one constructor per variant. Build envelopes with `Event::new` (UUIDv7
  `event_id`).
- **The key is the ordering unit.** Kafka orders per partition, so key by the
  entity whose events must stay ordered: the thread root for messages, the
  session for agent sessions, the lowercased PR key for pull requests. Every
  variant on a topic must use the same keying.
- Metadata carries ids and the committed state consumers need; consumers should
  not have to read back the database to act. Never put secrets or header values
  in metadata (see the webhook README's management events).
- Domain crates depend on `macro_event_broker` with `default-features = false`.
  Only composition roots pull in the Kafka adapters; event types consumed by the
  self-hosted daemon once dragged `rdkafka` into its build.

## 3. Publish after the commit

- Define a publisher port in the domain and implement it in an adapter over
  `MacroEventBroker` (`GithubPullRequestEventPublisher` +
  `BrokerGithubPullRequestPublisher`, `MessageEventPublisher` +
  `BrokerMessagePublisher`). Small domains such as `crates/forms` take
  `B: MacroEventBroker` directly; either keeps Kafka types out of
  `src/domain/**` ([CS-51](../../.agents/rules/rust/architecture.md)).
- Publish only after the transaction commits, from committed state (see
  `PropertiesServiceImpl` building update events "from committed persistence
  state"). A publish inside the transaction announces changes that may roll back.
- A failed publish is logged, never surfaced: the change already committed.
  There is no outbox; delivery is at most once relative to the write.
- Tests: a recording `MacroEventBroker` that captures topic, key, and
  `serde_json::to_value(event.event())`, asserting the full JSON literal
  (`crates/messages/src/outbound/broker/test.rs`). That literal is the wire
  contract.

## 4. Wire a real broker into every composition root

Services default their broker generic to `NoopMacroEventBroker`, so a composition
that forgets it compiles and silently publishes nothing.

- Find every place the producing service is constructed: its service binaries,
  `crates/ai_tools/src/tool_context.rs` (AI tools and MCP; use
  `MaybeToolEventBroker`), and any other host. A write path left on the no-op
  broker is a write that never produces an event.
- Build the broker as `MacroEventBrokerService::new(KafkaEventPublisher::new(..)?,
  tracker)` with a `TaskTracker`, and on shutdown close the tracker and wait with
  a timeout so in-flight publishes drain. Copy `services/calendar_service/src/main.rs`
  (`EVENT_BROKER_DRAIN_TIMEOUT`).
- A host that has never published needs `KAFKA_BROKERS` config and Kafka IAM; see
  [new-service.md](new-service.md) sections 3 and 4.

## 5. Teach every existing consumer of the topic

Consumers decode with the same Rust enum, so a new variant compiles everywhere;
what each one *does* with it is decided by its match. List them:

```sh
rg -l 'declare_topics!' crates services | xargs rg -l '<XMacroEvent>'
```

| Consumer | What to add | Silent-drop behavior if you don't |
| --- | --- | --- |
| Webhook ingestion and SSE, `crates/webhook/src/domain/ingestion.rs` + `ingestion/stream.rs`, topic list in `crates/webhook/src/topics.rs` | A normalization arm and audience, a case in `ingestion/test.rs`, a row in the README event table | An agent-trigger shape with no arm is rejected as `InvalidEntityId` ("unrecognized agent-trigger event shape") and committed; the error is logged in DSS, not by the producer, so the producer looks healthy while nothing reaches the daemon |
| Realtime Soup, `crates/soup_realtime/src/inbound/kafka_consumer.rs` | Patches for every Soup item the event changes, including items reached through the event (entities shared into a channel) | No patch means no realtime update; the channel-shared case was missed once |
| Activity, `services/document_storage_service/src/service/activity.rs` and the owning domain's activity mapping | Map the variant to an activity row | No activity entry |
| Search, `services/search_processing_service/src/inbound/kafka_consumer.rs` | Index or delete | Stale search results |
| Routines and scheduled actions, `services/scheduled_action/src/inbound/kafka_consumer.rs` | Trigger filter support | Routine never fires |
| Agent triggers, `crates/agent_trigger/src/domain/sources.rs` | Trigger input, when the event should start an agent | No agent session |

Adding a **new topic** to an existing consumer means adding its `XMacroEvent` to
that consumer's `declare_topics!` list. The group then reads a partition it has
never committed on: with the default `InitialOffset::Earliest` it replays the
topic's full 7-day retention. Every group that took on `macro.messages` had to be
switched to `INITIAL_OFFSET = InitialOffset::Latest` for this reason; set it
deliberately when you extend a subscription.

## 6. Add a consumer (optional)

A consumer is an inbound adapter: decode, call a domain service, commit. No SQL in
it ([CS-53](../../.agents/rules/rust/architecture.md)).

- **Grouped or ungrouped.** Durable work (indexing, linking, delivery) uses a
  group: a marker type implementing `kafka_util::GroupName` with a stable
  kebab-case `GROUP_NAME` and a deliberate `INITIAL_OFFSET`. Per-process fan-out
  to connected clients (GraphQL subscriptions, SSE) uses `Ungrouped` at
  `InitialOffset::Latest` and commits nothing; clients that miss events refetch.
- **Group names are identities.** Renaming one starts from scratch (replay or
  skip, depending on `INITIAL_OFFSET`). Two binaries that share a group split
  the partitions, so each sees only part of the stream. Locally, a grouped consumer pointed at dev
  Kafka takes partitions from the deployed consumers; keep such workers off dev
  infrastructure (see [new-service.md](new-service.md) section 6).
- **Decode failures.** `decode_payload` fails for unknown topics, malformed
  JSON, unknown variants, and `UnsupportedSchemaVersion`. Log and commit them so
  one bad record cannot wedge a partition.
- **Commit after the work, never before.** Retry transient failures in process
  with bounded exponential backoff (`tokio_retry`), keeping the worst case well
  under librdkafka's 300 s `max.poll.interval.ms`. Then either commit (success or
  logged terminal failure) or return an error without committing so the
  supervisor restarts and Kafka redelivers. Commits are cumulative: committing a
  later offset skips an earlier failed one, so a consumer that wants to hold a
  record must stop or call `pause_message_partition`. Realtime Soup first left
  failed records uncommitted for a restart to redeliver; it was rewritten to
  retry with backoff and then commit, so one failing fan-out cannot stall the
  partition.
- **Idempotency.** Delivery is at least once and replays happen after
  cancellation. Make handlers insert-if-absent or full-state, or dedupe on
  `event_id`.
- **Cancellation.** Select on the shutdown future around both `recv` and the
  work; leave an interrupted event uncommitted.
- **Tracing.** Wrap decode, handling, and commit in
  `kafka_util::consumer_span(message, GROUP_NAME)` so the consumer joins the
  producer's trace (producers inject trace headers automatically), and record
  failures with `record_span_error`. See the
  [observability rule](../../.agents/rules/observability.md).
- **Spawn it.** A consumer that is built but never spawned was shipped once.
  Run it in the host's `consumer_tracker` with a restart loop, a delay between
  restarts, and the shared cancellation token; copy the CRM call-link block in
  `services/document_storage_service/src/server.rs`. A brand-new consumer
  service follows [new-service.md](new-service.md), using
  `services/agent_trigger_service` as the model.

## 7. Change an existing payload safely

Producers and consumers deploy separately, and topics retain 7 days, so every
payload change must be readable by both the deployed code and the new code.

- **Additive only.** A new field is `Option<_>` with `#[serde(default)]`
  (`previous_value` on property update events), or it fails to decode every
  retained message published before it. A new variant is fine for consumers
  already on the new code; consumers still on old code fail to decode it and
  commit it as poison, so deploy consumers that must act on it first.
- **Never rename or remove** a field, variant, or `event_type` string in place.
  Add the new one, migrate consumers, then remove the old one in a later PR.
- **`SCHEMA_VERSION` bumps are breaking.** `declare_topics!` rejects any version
  other than the consumer's compiled one, in both directions. Additive changes
  do not bump it.

## 8. Public contract (webhook-delivered topics only)

Variants on `macro.documents`, `macro.channels`, `macro.messages`, and
`macro.agent_session_lifecycle` reach customers through `WebhookEvent`
(`crates/webhook/src/domain/events.rs`), which is part of the storage OpenAPI spec.

- Derive `utoipa::ToSchema` on the new metadata under the crate's `schema` or
  `inbound` feature, like `MessageTopicEvent`.
- Regenerate: `bun run gen-api cloud-storage` in `apps/web`, then
  `just update-generated` in `packages/sdk`. Commit both generated trees.
- Hydrate it in the SDK (`packages/sdk/src/events/hydrate/`, routed from
  `src/events/receiver.ts`); see the
  [add-sdk-endpoint skill](../../.agents/skills/add-sdk-endpoint/SKILL.md) for
  SDK conventions.

## Verify locally

```sh
cargo x kafka-topics --check
cargo test -p macro_event_topics -p <producer> -p <each consumer you touched>   # SQLX_OFFLINE unset
just rust-check && just clippy
just run_local
```

A restored init snapshot does not include a topic added since it was taken
(snapshots are not keyed on topics), so create it on the running broker. Find the
container with `docker ps --filter name=kafka`:

```sh
docker exec <kafka-container> /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:29092 \
  --create --if-not-exists --topic macro.<name> --partitions 6
docker exec <kafka-container> /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:29092 \
  --topic macro.<name> --from-beginning
```

Trigger the write in the app, confirm the envelope shape and key on the console
consumer, then confirm each consumer from section 5 acted (webhook delivery,
realtime update, activity row). Find the producer-to-consumer trace in Tempo with
the `live-debug` skill.

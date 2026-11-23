# soup_realtime

## What it is

Part of the Soup query feature (Home/Recent/Signal) — keeps cached Soup
results live by turning document/project/chat/email/channel/property/call Kafka
events into recipient-targeted Soup patches, and fanning those out to
instance-local, user-keyed subscriptions. No composition root; starts no
tasks itself.

## Start here

- `src/domain/service.rs`: resolves the current accessors of a batch of patches
  in one access lookup (plus an uncached roster read per channel a membership
  removal changed) and publishes one `Patch` per recipient to `macro.soup`.
- `src/domain/models.rs` + `src/domain/ports.rs`: the `Patch<Entity>` shape
  and the ports the service depends on.
- `src/inbound/kafka_consumer.rs`: maps each source Kafka event to
  `Patch::Updated`/`Patch::Deleted` (`consumer` feature).
- `src/outbound/soup_consumer.rs`: `SoupRealtimeConsumerService`, consuming
  recipient-targeted patches into per-user subscriptions.
- `src/outbound/kafka_publisher.rs`, `entity_access.rs`, `agent_sessions.rs`:
  the Kafka and access-expansion adapters; `entity_access.rs` makes one
  `EntityAudienceLookup` call per entity type in a batch.

## Scope

- Owns: event → recipient-targeted Soup patch mapping, and local fan-out of
  those patches to subscribers.
- Not here: the Soup query/filter logic itself → `soup`; deciding what's
  filterable/cacheable per entity → `soup_filter_projection`.

## Boundaries

- Depends on: `macro_event_broker`, `macro_event_topics`, `model-entity`,
  `model_owner`; feature-gated: `channels`, `chat`, `documents`, `email`,
  `call`, `github_pull_requests`, `initiative`, `properties`, `projects`,
  `system_properties`, `rdkafka` (`consumer`), `agent_session`/`entity_access`
  (`outbound`).
- Used by: `complete_graph`, `graphql_soup`, `attention_feed`.

## Recipes

- Add a new source event: `src/inbound/kafka_consumer.rs` (map to `Patch`) →
  `src/domain/service.rs` if access expansion differs → its test in
  `src/inbound/kafka_consumer/test/`.

## Checks

- `cargo test -p soup_realtime` (`SQLX_OFFLINE` unset).

## Gotchas

- An event's patches go out in batches of up to 500 (`NOTIFY_BATCH_SIZE`), one
  recipient lookup each, retried as a unit: a retry republishes the batch, and
  the event span records `entity_count`, `recipient_lookup_count`,
  `recipient_set_count` and `publish_count`.
- A source event's offset commits once every batch is published, or once a
  batch exhausts its five attempts: the rest of that event is then logged and
  dropped, so one event cannot wedge its partition. Shutdown mid-event leaves
  it uncommitted for redelivery, so downstream consumers must tolerate
  duplicate patches. The Soup-topic receiver (`SoupRealtimeConsumerService::run`)
  instead returns after five failed receives for its supervisor to restart.
- Property definition/option lifecycle events are intentionally ignored; they
  don't identify every affected entity.
- Channel threads use their containing channel as the access source.
- Recipients come from current access when the event is processed, so an
  entity hard-deleted before then reaches no one by lookup. `channel.deleted`
  names the members it had (`participant_user_ids`), and its `Deleted` patch
  goes to them as well (`SoupRealtimePatch::with_named_recipients`); events
  from before that field reach only current accessors.
- The audience lookup answers channels from entity access's roster cache,
  up to ten seconds old, so a membership event is not routed by it alone.
  `channel.participant_added` names the added users as recipients.
  `channel.participant_removed` updates the channel for its remaining members
  and sends the removed members their own patch
  (`SoupRealtimePatch::only_for_former_members`): `Updated` for a team or
  public channel, which they can still open unjoined, `Deleted` for a private
  channel or DM. That patch has the channel's roster read now, uncached
  (`UserAccessExpander::current_channel_members`), once per channel in a
  batch, and the members' update uses the same read: a removed member added
  back before the event is consumed gets only the members' update. Channel
  side effects publish from separate tasks, so a re-add can be published
  before the removal it follows; the removal's roster read still sees the
  rejoin. Every channel settings patch raises `channel.updated`, so conversions and
  auto-join changes reach members too, and so does a change of the bots in a
  channel that `crates/bots` makes (it raises one with the name unchanged).
  An agent DM's membership repair (`crates/channels` `ensure_agent_dm`)
  raises nothing: no writer marks a direct agent DM row left except deleting
  its bot, after which the DM cannot be reopened.
- Agent sessions have no source event here: their patches come from channel
  references, linked pull requests, and the harness publishing through
  `outbound/agent_sessions.rs`' `SoupWorkRegistrationSignal` for registered work.
- Only `call.record_imported` patches calls; native call lifecycle events on
  `macro.calls` are ignored. The web cache has no local call projection, so a
  call patch makes mounted lists that can contain calls refetch
  (`apps/web/src/lib/queries/soup/graphql/call-list-revalidation.ts`).

## Related

- `README.md` (same content as above, kept for non-agent readers)

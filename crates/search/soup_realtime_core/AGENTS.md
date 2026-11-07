# soup_realtime_core

## What it is

Part of the Soup query feature (Home/Recent/Signal). Keeps cached Soup
results live: the domain service expands current access for a changed entity
and publishes one `Patch` per recipient to `macro.soup`, and
`SoupRealtimeConsumerService` fans recipient-targeted patches out to
instance-local, user-keyed subscriptions. No composition root; starts no
tasks itself.

The Kafka event consumer is `crates/search/soup_realtime_inbound`; the Kafka,
access and agent-session adapters are `crates/search/soup_realtime_outbound`.

## Start here

- `src/service.rs`: resolves the current accessors of a batch of patches in
  one access lookup, publishes one `Patch` per recipient to `macro.soup`, and
  runs the subscription fan-out.
- `src/models.rs` + `src/ports.rs`: the `Patch<Entity>` shape and the ports
  the service depends on.

## Scope

- Owns: patch models, ports and fan-out orchestration.
- Not here: mapping source events to patches → `soup_realtime_inbound`;
  Kafka and access adapters → `soup_realtime_outbound`; the Soup query/filter
  logic itself → `soup`; deciding what's filterable/cacheable per entity →
  `soup_filter_projection`.

## Boundaries

- Depends on: `macro_event_broker`, `macro_event_topics`, `macro_user_id`,
  `model_entity`. Ports and the service are behind the default `ports`
  feature.
- Used by: `complete_graph`, `graphql_soup`, `graphql_registered_work`,
  `attention_feed`, the two adapter crates, and the DSS and harness roots.

## Checks

- `cargo test -p soup_realtime_core`

## Gotchas

- The Soup-topic receiver (`SoupRealtimeConsumerService::run`) returns after
  five failed receives for its supervisor to restart.

## Related

- `README.md`: the patch protocol for non-agent readers.

# soup_realtime_inbound

## What it is

Part of the Soup query feature (Home/Recent/Signal): the Kafka consumer that
maps document/project/chat/email/channel/property/call/pull-request events to
`Patch::Updated`/`Patch::Deleted` and drives `soup_realtime_core`'s service.
It depends on every source domain's event types, which is why it is its own
crate: a mapping edit rebuilds only this crate and DSS.

## Start here

- `src/kafka_consumer.rs`: `run_entity_update_consumer` (the loop DSS
  starts) and `process_event`, one `patches_from_<kind>_event` per source.

## Boundaries

- Depends on: `soup_realtime_core` and the source domains' event types
  (`call`, `channels`, `chat`, `documents`, `email`, `github_pull_requests`,
  `initiative`, `messages`, `projects`, `properties`, `system_properties`).
- Used by: `services/document_storage_service` only.

## Recipes

- Add a new source event: `src/kafka_consumer.rs` (map to `Patch`) →
  `soup_realtime_core`'s `src/service.rs` if access expansion differs → its
  test in `src/kafka_consumer/test/`; add the domain crate to this
  `Cargo.toml`.

## Checks

- `cargo test -p soup_realtime_inbound`

## Gotchas

- An event's patches go out in batches of up to 500 (`NOTIFY_BATCH_SIZE`), one
  recipient lookup each, retried as a unit: a retry republishes the batch, and
  the event span records `entity_count`, `recipient_lookup_count`,
  `recipient_set_count` and `publish_count`.
- A source event's offset commits once every batch is published, or once a
  batch exhausts its five attempts: the rest of that event is then logged and
  dropped, so one event cannot wedge its partition. Shutdown mid-event leaves
  it uncommitted for redelivery, so downstream consumers must tolerate
  duplicate patches.
- Property definition/option lifecycle events are intentionally ignored; they
  don't identify every affected entity.
- Channel threads use their containing channel as the access source.
- Recipients come from current access when the event is processed, so an
  entity hard-deleted before then reaches no one by lookup. `channel.deleted`
  names the members it had (`participant_user_ids`), and its `Deleted` patch
  goes to them as well (`SoupRealtimePatch::with_named_recipients`); events
  from before that field reach only current accessors.
- Agent sessions have no source event here: their patches come from channel
  references, linked pull requests, and the harness publishing through
  `soup_realtime_outbound`'s `SoupWorkRegistrationSignal` for registered work.
- Only `call.record_imported` patches calls; native call lifecycle events on
  `macro.calls` are ignored. The web cache has no local call projection, so a
  call patch makes mounted lists that can contain calls refetch
  (`apps/web/src/lib/queries/soup/graphql/call-list-revalidation.ts`).

# event_exposure

## What it is

Part of event streams (webhooks and SSE through the public API and SDK). The
vocabulary every broker event uses to declare whether it leaves Macro, to whom,
and in what shape: `Exposure`, `Audience`, `EntityRef`, `Stage`.

## How it works

`macro_event_broker::TopicEvent::exposure()` (required, no default) returns an
`Exposure` per variant: `Internal(reason)` or `Public { name, entity, audience,
stage, payload }`. Delivery crates (`crates/webhook` today) resolve the
`Audience` against current access and serialize the payload inside the broker
envelope. Producers reach these types through `macro_event_broker::exposure`.

## Scope

- Owns: the exposure and audience vocabulary only.
- Not here: resolving audiences (entity accessors, teams, contacts) →
  `crates/webhook`; topic lists → `crates/macro_event_topics`.

## Boundaries

- Depends on: `model-entity`, `macro_user_id`, `serde`, `thiserror`, `uuid`.
  Keep it a leaf: never `entity_access`, Kafka, or a domain crate.
- Used by: `macro_event_broker` (the `TopicEvent` trait), every producer's
  `exposure()` impl, `crates/webhook`.

## Recipes

- Declare a new event: `docs/guides/add-kafka-event.md`, "Declare exposure".
- Add an audience class: `Audience` here → its ingestion and stream mappings in
  `crates/webhook/src/domain/ingestion.rs` and `ingestion/stream.rs`.

## Checks

- `cargo test -p event_exposure`
- Changing a delivered event's exposure: `cargo test -p webhook` (the
  wire-shape tests pin today's JSON).

## Gotchas

- `exposure()` matches are exhaustive with no `_ =>` arm (ast-grep
  `rust-exposure-no-wildcard-arm`), so a new variant must be classified.
- A public payload is an explicit projection that derives `utoipa::ToSchema`;
  routing fields (recipients, snapshots) go on the `Audience`, never in the
  payload.
- Internal reasons say whether an event is internal by design or which phase
  makes it public (`PendingPhase`); later phases search for them.

# event_access

## What it is

Part of event streams (webhooks and SSE through the public API and SDK). The
contract every broker event implements to declare whether it leaves Macro, to
whom, and in what shape: the `EventAccess` trait and its vocabulary
(`Access`, `Audience`, `EntityRef`, `Stage`).

The access model (who receives what and why, access loss, how to expose a
family) is [ACCESS_MODEL.md](ACCESS_MODEL.md). Read it before changing an
event's access.

## How it works

`macro_event_broker::TopicEvent` requires `EventAccess` as a supertrait (no
default). `EventAccess::access()` returns `Access::Internal { reason }` or
`Access::Public(PublicEvent { name, entity, audience, stage, payload })` per
event. `crates/event_stream` and `crates/webhook` resolve the `Audience`
against current access and serialize the payload inside the broker envelope.
Producers reach these types through `macro_event_broker::access`.

## Scope

- Owns: the access contract and its vocabulary only.
- Not here: resolving audiences (entity accessors, teams, contacts) →
  `crates/event_stream/src/domain/access.rs` and
  `crates/webhook/src/domain/ingestion.rs`; topic lists →
  `crates/macro_event_topics`.

## Boundaries

- Depends on: `model-entity`, `macro_user_id`, `serde`, `thiserror`, `uuid`.
  Keep it a leaf: never `entity_access`, Kafka, or a domain crate.
- Used by: `macro_event_broker` (the `TopicEvent` supertrait), every
  producer's `impl EventAccess`, `crates/event_stream`, `crates/webhook`.

## Recipes

- Expose a family or declare a new event: ACCESS_MODEL.md, "Exposing a
  crate's events".
- Add an audience class: `Audience` here → `AudienceResolver::admits` in
  `crates/event_stream/src/domain/access.rs` → the webhook mapping in
  `crates/webhook/src/domain/ingestion.rs` → the table in ACCESS_MODEL.md.

## Checks

- `cargo test -p event_access`
- Changing a delivered event's access: `cargo nextest run --all-features -p
  event_stream -p webhook` (registry consistency and the wire-shape tests).

## Gotchas

- `access()` matches are exhaustive with no `_ =>` arm (ast-grep
  `rust-access-no-wildcard-arm`, which also covers helpers returning an
  `Access`), so a new variant must be classified.
- A public payload is an explicit projection that derives `utoipa::ToSchema`;
  routing fields (recipients, snapshots) go on the `Audience`, never in the
  payload.
- Personal data uses `Audience::Recipient`. No audience but `Team`,
  `Workspace`, `GithubInstallation` and an entity the team itself holds
  reaches a team webhook (ACCESS_MODEL.md, "Team webhooks").
- An internal reason is one plain string: why the event is internal, or what
  is missing before it could be public.
- `event_access::AccessError` (a broken event contract) is not
  `entity_access::AccessError`; crates using both alias one
  (`EventAccessError` in `crates/webhook`).

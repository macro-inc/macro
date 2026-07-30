# Properties crate

This crate owns property definitions, selectable options, entity property values,
persistence ports, service policy, and the HTTP, GraphQL, and tool adapters for
properties. Its broker-aware domain service also produces property mutation events
after successful writes.

## Properties event producer

The events below use schema version 1 and are published to the
`macro.properties` Kafka topic in the standard broker envelope:

```json
{
  "event_id": "<uuidv7>",
  "schema_version": 1,
  "event_type": "<domain>.<action>",
  "metadata": { "...": "typed fields described below" }
}
```

The Kafka record key is not part of this JSON envelope. Every metadata object
includes `actor_user_id`, which is a nullable Macro user ID. It identifies the
authenticated user responsible for the mutation and is `null` for internal,
machine, bot, or unauthenticated callers. In particular, document-deletion
cleanup is an internal call and produces `entity_properties.cleared` with a null
actor. Optional metadata fields are serialized as `null` unless their reused
nested model specifies otherwise.

| Event name | Emitted after | Metadata |
| --- | --- | --- |
| `property.created` | A property definition is persisted. A newly created TAG definition from `ensure_tag_set` also emits this event; the get-existing path does not. | `property_definition_id`, `actor_user_id`, `owner`, `display_name`, `data_type`, `is_multi_select`, `specific_entity_type`, `created_at` |
| `property.deleted` | A property definition is deleted. | `property_definition_id`, `actor_user_id`, `owner`, `display_name`, `data_type` |
| `property_option.created` | An option is added to a SELECT or TAG definition. | `option_id`, `property_definition_id`, `actor_user_id`, `value`, `color`, `display_order` |
| `property_option.updated` | An option is renamed, recolored, or reordered. The metadata is the full post-update state, not a delta. | `option_id`, `property_definition_id`, `actor_user_id`, `value`, `color`, `display_order` |
| `property_option.deleted` | An option is deleted. `value` is the pre-delete snapshot. | `option_id`, `property_definition_id`, `actor_user_id`, `value` |
| `entity_property.updated` | An entity value is set, replaced, attached with a null value, or changed by an option add/remove. Bulk operations emit one event for each actual `(entity, property_definition)` mutation. | `entity_property_id`, `entity_id`, `entity_type`, `property_definition_id`, `actor_user_id`, `value`, `updated_at` |
| `entity_property.deleted` | One entity-property row is deleted. | `entity_property_id`, `entity_id`, `entity_type`, `property_definition_id`, `actor_user_id` |
| `entity_properties.cleared` | `delete_entity_properties` successfully wipes all property values for an entity, including the document-deletion path. One clear event replaces per-value deletion events. | `entity_id`, `entity_type`, `actor_user_id` |

`entity_property.updated.value` is the complete new value and may be `null` when
the row remains attached without a value. UUID and timestamp fields serialize as
strings.

### Keys and ordering

Keys are exact, bare ID strings with no domain prefix:

- Definition and option records use the bare `property_definition_id` UUID, for
  example `3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90`, not
  `property|3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90`.
- Entity-property records use the bare `entity_id` string, not an
  `entity|<id>` or `<entity_type>|<id>` value.

Definition creation, its option mutations, and definition deletion therefore
retain per-definition ordering. All property value mutations for one entity
retain per-entity ordering, even when they concern different definitions.

There is no ordering guarantee between definition-keyed records and
entity-keyed records. A consumer may observe an `entity_property.updated`
referencing a definition before or after that definition's lifecycle event.
There is likewise no ordering guarantee across different definition IDs or
across different entity IDs.

## Wire representations

The event types directly reuse `DataType`, `EntityType`, `PropertyOwner`,
`PropertyValue`, and `PropertyOptionValue` from `models_properties`. Their serde
representations are public wire-contract dependencies. Changes to those model
representations must therefore be treated as changes to the Kafka contract, not
as crate-internal refactors.

The current representations include:

- `DataType` and `EntityType` as `SCREAMING_SNAKE_CASE` strings, such as
  `"SELECT_STRING"`, `"TAG"`, `"DOCUMENT"`, and `"TASK"`.
- `PropertyOwner` as an internally tagged object:
  `{"scope":"user","user_id":"macro|user@example.com"}`,
  `{"scope":"team","team_id":"<uuid>"}`, or `{"scope":"system"}`.
- `PropertyOptionValue` as `{"type":"string","value":"..."}` or
  `{"type":"number","value":42.5}`.
- `PropertyValue` as a `type`/`value` object. Its type names are `Boolean`,
  `Number`, `String`, `Date`, `SelectOption`, `EntityReference`, and `Link`.
  Select options, entity references, and links use arrays as defined by
  `models_properties`, including for single-select values.

Consumers should use these exact representations rather than independently
normalizing enum names or tagged-union shapes.

## Sanitization and data handling

Payloads intentionally contain property metadata and complete property values.
Property display names, string option values, string property values, and link
values can contain user-authored text. `actor_user_id`, user-scoped
`owner.user_id`, and user entity references such as task assignees can contain
Macro user IDs serialized as `macro|<email address>` and must be handled as
personal data.

The producer does not redact those contract fields. Its sanitization boundary
excludes document and message content, authentication material, secrets, and
billing identifiers; it does not make property names, options, values, entity
references, or actor identities non-sensitive. Consumers must apply storage,
logging, and access controls appropriate for PII and user-authored values.

## Implied mutations and known gaps

Definition and option deletion have effects beyond the single event:

- `property.deleted` implies removal of every option and every entity-property
  value under that definition. The database cascade does not emit
  `property_option.deleted` or per-entity deletion events.
- `property_option.deleted` implies that the option ID was stripped from every
  entity value that referenced it. This does not fan out
  `entity_property.updated` records.

Consumers maintaining derived state must apply these implications. Definition
and entity records use different keys, so the lack of cross-key ordering also
applies while handling these cascades.

Parent Task and Subtasks writes update reciprocal task relationships in the
same transaction. Version 1 emits `entity_property.updated` only for the entity
targeted by the API call; it omits a separate event for each reciprocally
updated task.

There is no `property.updated` event because no endpoint currently edits a
property definition. A future definition-edit operation can add that event as a
forward-compatible enum variant. TAG definition creation uses
`property.created`; there is no separate `tag_set.created` event.

The `soup_realtime` consumer subscribes to `macro.properties`. It maps entity
property updates, deletions, and clears to updated Soup entities and fans them
out to every current accessor. Task property entities map to their document
representation. Definition and option lifecycle events remain ignored because
they do not identify every affected entity.

## Producer composition

The document storage service (DSS) is the broker-aware production composition.
Its shared `PropertiesServiceImpl` publishes for DSS REST and GraphQL writes,
task-property adapter writes, and document-deletion cleanup.

`PropertiesServiceImpl` defaults to `NoopMacroEventBroker` when a composition
does not call `with_event_broker`. The following composition sites retain that
no-op default and do not publish property events:

- `crates/properties_service/src/api/context.rs` omits the broker generic from
  its concrete `PropertiesService` alias.
- `crates/ai_tools/src/tool_context.rs` omits the broker generic from
  `ToolPropertiesService`, and `build_properties_service` does not attach a
  broker. Property and task-property writes through contexts built there,
  including document cognition, MCP, memory, and the shared AI tool context,
  therefore do not publish.

These are explicit producer coverage boundaries, not fallback delivery paths.

## Delivery semantics and compatibility

Publication is scheduled after the relevant database mutation commits and is
fire-and-forget. Scheduling or Kafka publication failure is logged without
rolling back the mutation or failing an otherwise successful request. There is
no transactional outbox and no retry coupling persistence to publication.
Producer delivery is therefore at-most-once relative to mutations: a committed
mutation can have no corresponding event.

Kafka consumers commonly receive at-least-once delivery when they commit an
offset only after successful processing. Consumers must be idempotent under
redelivery and downstream retries. They can use `event_id` for deduplication and
should make full-state updates and deletion implications safe to apply more than
once. Consumers requiring strong consistency must reconcile against the source
API or database because the producer cannot guarantee an event for every
commit.

Consumers must check `schema_version` before interpreting a known event. Every
event documented here currently uses version 1. To remain forward compatible,
consumers must tolerate unknown `event_type` values and ignore unknown metadata
fields; additive event variants and fields do not require a version change.

## Rollout

Provision `macro.properties` before or alongside deploying DSS. Deploy the
Kafka cluster stack so it consumes the regenerated
`.github/kafka-cluster-topics.json`, then deploy DSS in the same release or
afterward. If DSS starts producing before the topic is available, mutations
still succeed but events may be lost under the at-most-once contract.

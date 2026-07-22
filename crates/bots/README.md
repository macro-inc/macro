# Bots crate

This crate owns bot models, persistence ports, service policy, and HTTP adapters.
The bot service also produces sanitized lifecycle events for successful bot
mutations.

## Lifecycle event producer

Successful create, patch, and soft-delete mutations publish schema-version-1
events to the `macro.bots` Kafka topic. Every record uses the subject bot's bare
UUID string as its Kafka key (for example,
`0197f776-6e7b-7c69-a251-780ae754d3e4`, without a `bot|` prefix). Events for one
bot therefore use the same Kafka partition key. The Kafka key is not part of
the JSON envelope.

| Event name | Emitted after | Metadata |
| --- | --- | --- |
| `bot.created` | Regular or channel-scoped bot creation | `bot_id`, `kind`, `owner`, `name`, `handle`, `description`, `avatar_url`, `created_by_user_id`, `channel_id`, `created_at` |
| `bot.updated` | Bot PATCH | `bot_id`, `owner`, `actor_user_id`, requested `name`, `handle`, `description`, and `avatar_url` fields, plus `updated_at` |
| `bot.deleted` | Bot soft deletion | `bot_id`, `owner`, `actor_user_id` |

`owner` is a tagged union. A user owner is encoded as
`{"type":"user","user_id":"..."}`, while a team owner is encoded as
`{"type":"team","team_id":"..."}`. On `bot.created`, `channel_id` is the
channel UUID for channel-scoped creation and `null` for regular creation. On
`bot.updated`, the mutable fields describe the requested PATCH rather than a
full bot snapshot; an omitted field is serialized as `null`.

A created event has this wire-envelope shape:

```json
{
  "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
  "schema_version": 1,
  "event_type": "bot.created",
  "metadata": {
    "bot_id": "0197f776-6e7b-7c69-a251-780ae754d3e4",
    "kind": "owned",
    "owner": {
      "type": "team",
      "team_id": "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90"
    },
    "name": "Deploy Bot",
    "handle": "deploy-bot",
    "description": null,
    "avatar_url": null,
    "created_by_user_id": "macro|creator@example.com",
    "channel_id": null,
    "created_at": "2026-07-20T17:01:02Z"
  }
}
```

## Sanitization and excluded flows

Lifecycle payloads never expose bot token values, hashes, IDs, prefixes, labels,
or expiration metadata. This applies to channel-scoped creation even though its
HTTP response contains newly generated token material.

Only successful bot creation, PATCH, and soft deletion produce lifecycle
events. Read and list operations, token creation, use, rotation, revocation, and
other token lifecycle operations do not publish them. Channel-membership flows
also do not publish bot lifecycle events.

Webhook consumption of `macro.bots` is not included in this change. The webhook
Kafka consumer and webhook delivery pipeline do not consume or deliver these
bot events.

## Delivery semantics and rollout

Publication occurs after the repository mutation and is fire-and-forget. The API
does not wait for Kafka delivery, and a scheduling or publication failure is
logged without rolling back or failing an otherwise successful mutation. There
is no transaction, outbox, or retry coupling database persistence to event
publication. A persisted mutation can therefore have no corresponding event;
production is at-most-once relative to bot lifecycle mutations.

Provision `macro.bots` before deploying the Document Storage Service (DSS)
producer. If DSS is deployed first, mutations still succeed, but events emitted
before the topic is available can be benignly lost under the at-most-once
contract.

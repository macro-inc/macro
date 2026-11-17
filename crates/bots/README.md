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
| `bot.channel_changed` | A bot added to or removed from a channel (`add_bot_to_channel`, `remove_bot_from_channel`) | `bot_id`, `channel_id`, `change` (`joined` or `left`), `actor_user_id` |

`owner` is a tagged union. A user owner is encoded as
`{"type":"user","user_id":"..."}`, while a team owner is encoded as
`{"type":"team","team_id":"..."}`. On `bot.created`, `channel_id` is the
channel UUID for channel-scoped creation and `null` for regular creation. On
`bot.updated`, the mutable fields describe the requested PATCH rather than a
full bot snapshot; an omitted field is serialized as `null`.

`bot.channel_changed` was added after the other three. A consumer deployed
before it fails to decode it and skips it (the profile push commits and moves
on), so consumers must tolerate event types they do not know.

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

## Profile push to web clients

Document Storage Service runs `BotProfileConsumer` (feature `realtime`,
consumer group `bot-profile-push`, starting at the topic's head). For every
`macro.bots` event it reads the bot's current profile, not the event's fields,
and sends it as a `bot_profile_changed` connection-gateway message to the bot's
audience: its owner, its team's members, and the people in the channels it is
in (for a deleted bot, the channels its deletion removed it from). The payload
is the `BotOwnerProfile` that `GET /bots/profiles` returns, so a deletion
arrives as a profile with `deleted_at` set. The web client writes it into its
bot profile cache, which messages, mention chips and agent sessions read, and
refetches its agent, bot and channel-bot lists. A failed push is retried with
backoff, then logged and dropped; clients refetch profiles when their gateway
connection reopens.

## Live updates over GraphQL

Every Document Storage Service process also reads `macro.bots` through
`BotTopicChanges`: no consumer group, every partition assigned from its end,
nothing committed. For each event, `BotUpdates` reads the bot's current
`BotIdentity` and `bot_audience` from the primary. It hands the identity to
that audience's `botUpdates` subscribers on that process. Processing joins the
publisher's trace through the Kafka trace headers. For `bot.channel_changed`,
the channel's current members hear it too, since a bot that left a channel is
no longer in its audience there. A change made while a
process restarts is not replayed; clients refetch the bots they show when they
resubscribe. This replaces the profile push once web clients read bots through
GraphQL.

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

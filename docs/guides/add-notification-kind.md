# Adding a notification kind

A notification kind is one `NotifEvent` variant. It is stored as a tagged JSON row,
pushed to phones, streamed to clients, served over REST and GraphQL, and rendered
by a dozen web modules. The compiler finds the Rust half; TypeScript finds most of
the web half; the rest is listed here. Most past kinds needed a follow-up fix, and
those misses are called out inline.

If the notification is about an entity type that has never carried notifications
(it has no inbox rows, mark-done, or mute yet), do that first with
[add-entity.md](add-entity.md); this guide assumes the entity side exists.

## Pick a model to copy

| Building | Copy | Why |
| --- | --- | --- |
| A kind on an existing entity, sent from a domain service | `ChannelMessageReaction` (`crates/channels/src/outbound/notification_sender.rs`) | Newest end-to-end kind: push, realtime, GraphQL, inbox stacking, settings toggle |
| Kinds planned from domain events, with derived ids | `AgentSession*` (`crates/agent_harness/src/domain/notifications.rs`) | Pure planner function, audience rules, idempotent ids, port + ingress adapter |
| A scheduled kind | `CalendarEventReminder` (`crates/calendar_events/src/outbound/notification_notifier.rs`) | Fired by a poller, collapse key per occurrence |

Names: the variant is `PascalCase`; `Notification::TYPE_NAME`, the serde tag, the
`notification_event_type` column, and the web `tag` are all its `snake_case`
(`channel_message_reaction`). Pick it once. A rename later needs a serde alias
*and* a data migration (see "Renaming" below).

## 1. Metadata type (required)

In `crates/model_notifications/src/metadata.rs` (or a submodule like
`metadata/crm_discussion.rs`):

- Define `<Name>Metadata` with `#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]`
  and `#[serde(rename_all = "camelCase")]`. Doc every field; utoipa and GraphQL
  descriptions come from them.
- Carry what clients need to render and navigate without another fetch (ids, a
  short content excerpt, display names). Do not carry anything you would not put
  in a push banner; the payload lands in the database, on phones, and in Kafka.
- Display names: carry a display name when the actor is not a Macro user (a bot,
  a GitHub login, an agent). Kinds that only carried an id later showed raw ids or
  emails in the inbox and needed fixes for bot and agent senders.
- Every field added *after* the first deploy must be `Option` or
  `#[serde(default)]`: rows already in the `notification` table lack it, and a row
  that fails to decode silently disappears from lists.
- `impl Notification` with `const TYPE_NAME = "<snake_name>"`.
- `impl NotificationTitle` (`format_title` / `format_body`). This text is the push
  banner, the Android notification, and the email digest preview. Branch on
  subtype where it changes the noun (a document mention of a task says "task";
  that was a fix). Render mention XML through the existing
  `parse_message_plain_text` helpers so bot and user mentions show their names.
- Push-capable kinds: `impl NotificationExtIos`. Build the alert with
  `alert_apns`, and choose `collapse_key` deliberately. It replaces an earlier
  banner on the device and is also the Android identifier, so key it on what a
  newer notification should supersede (the reaction keys on message + emoji, a
  reminder on its reminder id). Android pushes are derived from the APNS payload
  in `crates/notification/src/domain/service/egress.rs`; there is no separate
  Android formatter.
- Add title/body tests to `crates/model_notifications/src/metadata/test.rs`.

Only invite-style kinds send direct email (`NotificationExtEmail`, see
`crates/invite_email`). Everything else reaches email through the digest, which
formats any `NotifEvent` via `NotificationTitle`.

## 2. Register the variant (required)

In `crates/model_notifications/src/lib.rs`:

- Re-export the type from the `pub use metadata::{...}` list.
- Add the variant **at the end** of `NotifEvent` inside `define_notif_event!`. The
  macro fails the build if `TYPE_NAME` is not the variant's `snake_case`. Order
  matters for generated code: orval names union members by position
  (`notifEventOneOfFivefive`), so inserting in the middle renames dozens of
  generated web files.
- Add arms to both `format_title` and `format_body` in `impl NotificationTitle for NotifEvent`.

Then decide two lists in other crates; nothing will force you to:

- **Blockable:** add `<Name>Metadata::TYPE_NAME` to `BLOCKABLE_NOTIFICATIONS` in
  `services/notification_service/src/api/user_notification.rs` unless users must
  not be able to turn it off (account-security kinds like `inbox_reauth_required`
  stay out). The preferences endpoint rejects disabling any type not listed.
- **Category filter:** check `push_include_types_filter` in
  `crates/notification/src/outbound/repository.rs`. Categories mostly match on
  `event_item_type`, and `Message` also matches any metadata with a `messageId`.
  A new kind filed under an existing entity type joins that category, which leaked
  agent rows into the channel filter once. GitHub kinds are a hand-kept list
  (`GITHUB_EVENT_TYPES_SQL`) because this crate cannot see `model_notifications`.

Add a `to_typed_row_<snake_name>` case to
`services/notification_service/src/api/user_notification/test.rs`.

## 3. Send it from the owning domain (required)

Follow the [hexagonal architecture skill](../../.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md):
the domain decides *whether* and *to whom*; an outbound adapter calls
`NotificationIngress::send_notification`.

1. **Plan in the domain.** A pure function from the domain fact to the
   notifications it warrants, with tests for every audience rule. Copy
   `crates/agent_harness/src/domain/notifications.rs`.
2. **Port + adapter.** A domain port (e.g. `AgentSessionNotifier`) and an outbound
   adapter generic over `notification::domain::service::NotificationIngress`
   (`crates/agent_harness/src/outbound/notifications.rs`). Build the request with
   `SendNotificationRequestBuilder { notification_entity, secondary_notification_entity, notification, sender_id, recipient_ids }`,
   then `.into_request()`, `.with_apns()` for a push, and `.with_conn_gateway()`
   for live delivery.
3. **Wire the composition root.** Services construct
   `SqsNotificationIngress { queue: SqsQueue::new(sqs, macro_queues::NotificationIngressQueue::new().to_string()) }`
   (see `services/agent_harness_service/src/main.rs`). A service that has never
   notified also needs `sqs:SendMessage` on the ingress queue: take
   `notificationIngressQueueArn` from `getMacroNotify()`
   (`infra/packages/shared/src/macro_notify.ts`), as `infra/stacks/email-service/index.ts` does.

Pitfalls, each of which shipped once:

- **Sender.** Set `sender_id` to the acting Macro user; ingress then drops the
  sender from recipients. When the actor is not a Macro user id (GitHub, bots),
  filter the actor out yourself; users were notified of their own PR activity.
- **Audience.** Recipients must be people who can open the entity, computed from
  live data. Participants from deleted messages, and the callee instead of the
  caller in DM call titles, were both fixes.
- **Double notifying.** If another path already notifies the same people about
  the same thing (a channel message mentioning them), emit nothing. Agent mention
  notifications duplicated channel mention notifications until fixed.
- **No-op changes.** Gate on whether the state actually changed. An
  `ON CONFLICT DO NOTHING` re-add of a reaction still published "added" and
  re-notified.
- **Idempotent ids.** For event-driven producers, use `into_request_with_id` with a
  UUIDv5 derived from everything that makes two notifications distinct; ingress
  creates idempotently on the id. Leaving out a component (the question within a
  turn) silently swallows the second notification. Ingress also returns early for
  an existing id, so retrying a send whose row was written does not re-push.
- **Failure handling.** A failed enqueue is logged and dropped, not retried into
  the caller's transaction (see the adapter's doc comment).

Push banners are rendered in the **producing** service (ingress messages carry the
built APNS payload), so a `format_title` change only reaches phones once that
producer redeploys.

## 4. GraphQL (required)

In `crates/graphql_notification/src/notification_event.rs`:

- A wrapper `pub struct Graphql<Name>Metadata(<Name>Metadata);` with an
  `#[Object]` impl exposing each field (ids as `ID`).
- A variant in the `GraphqlNotifEvent` union and an arm in
  `From<NotifEvent> for GraphqlNotifEvent`.

Regenerate the SDL and the web client (see `crates/complete_graph/AGENTS.md`):

```sh
cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql
cd apps/web && bun gen-graphql
```

Any SDL change rotates every persisted client GraphQL cache; that is expected.

## 5. REST spec and generated clients (required)

`NotifEvent` is registered in `services/notification_service/src/api/swagger.rs`,
so new metadata types are pulled in transitively; listing them there is optional.
Regenerate and commit:

```sh
cd apps/web && bun run gen-api notification-service   # openapi.json, schemas, zod.ts
cd packages/sdk && bun run sync-specs && bun run generate
```

The web validates realtime notifications with the generated `zod.ts`; a stale one
logs parse warnings for the new kind. Never hand-edit `generated/` or `specs/`.

## 6. Web (required for anything user-visible)

The GraphQL union is mapped back to the REST `NotifEvent` shape, and every web
consumer matches on `notification_metadata.tag`.

1. `apps/web/src/lib/service-clients/service-storage/graphql/soup.graphql`: add
   `... on Graphql<Name>Metadata` to `SoupNotificationNavigationMetadataFields`
   (fields needed to route a click) or `SoupNotificationMetadataFields`. Alias
   every field with a variant prefix (`channelMessageReactionMessageId: messageId`);
   union members share field names with different types, which GraphQL rejects
   unaliased. Rerun `bun gen-graphql`.
2. `apps/web/src/lib/service-clients/service-storage/graphql-soup.ts`: an arm in
   `mapGraphqlNotificationMetadata` ending in `satisfies NotifEventMember<'<snake_name>'>`.
   Every GraphQL notification must go through `mapGraphqlNotification`; a past bug
   bypassed it.
3. Exhaustive matches, which type-check will flag:
   - `apps/web/src/features/notifications/notification-preview.ts` (label)
   - `apps/web/src/features/notifications/notification-metadata.ts` (action text, target)
   - `apps/web/src/features/notifications/notification-navigation.ts` (click target)
   - `apps/web/src/features/entity/extractors-notification/notification-icon.tsx`
   - `apps/web/src/features/entity/extractors-notification/notification-description-helpers.ts`
   - `apps/web/src/features/entity/utils/notification.ts`
4. Non-exhaustive matches that silently fall through; check each:
   - `apps/web/src/features/notifications/use-notification-updates.ts`: refresh
     only the affected Soup entity. Broad invalidation here caused list refresh
     storms.
   - `apps/web/src/features/notifications/notification-stacking.ts` and
     `apps/web/src/features/notifications/notification-source.ts` (`CHANNEL_EVENT_TYPES`)
   - Channel-thread scoping: `apps/web/src/features/notifications/channel-thread-root.ts`,
     `apps/web/src/features/notifications/top-level-channel-notification.ts`,
     `apps/web/src/features/soup/entity-notifications.ts`, and
     `apps/web/src/features/entity/utils/channel-thread-name.ts`. Reactions
     initially vanished from thread rows because one helper did not know the tag.
   - Inbox: `apps/web/src/features/next-soup/soup-view/views/inbox/inbox-card-layouts.tsx`
     and `apps/web/src/features/next-soup/soup-view/views/inbox/utils.ts`.
   - Desktop banners: `apps/web/src/features/notifications/notification-platform.ts`
     and `apps/web/src/features/notifications/notification-sender.ts` when the
     sender is not `sender_id`.
5. Settings: if blockable, add an entry to `NOTIFICATION_EVENT_GROUPS` in
   `apps/web/src/features/notifications/notification-event-catalog.ts`. It must
   match `BLOCKABLE_NOTIFICATIONS`; no test checks that.
6. Mobile push taps retain the notification id for authenticated lookup through
   `notification-navigation.ts`. iOS channel pushes also carry typed `navigation`
   data (channel, message, and nullable thread-root IDs) plus a per-recipient
   `recipientId`, allowing a matching signed-in account to open the destination
   before notification hydration. Add channel destinations in
   `crates/model_notifications/src/metadata/channel_push.rs` and the metadata's
   `NotificationExtIos` implementation; regenerate the service OpenAPI and the
   web push validators with `scripts/generate-api-schema.ts`. Older pushes and
   other notification kinds still follow the lookup path, so step 3 covers
   phones too. Never infer a root from an absent thread ID: the direct payload
   requires `threadId: null` for a known top-level message.

Mark done and mute act on the notification's entity, so an existing entity type
needs nothing more. Copy `.otherwise` arms rather than throwing: older tabs ignore
kinds introduced by a newer backend.

## 7. Server-built feeds (when relevant)

- **Home work feed:** `crates/work_feed/src/domain/stacking.rs` attributes channel
  notifications to thread roots and stacks comment events. A new kind defaults to
  a standalone stack (`_ => None`); add it to the thread-root and
  `is_channel_event` / `is_comment_event` matches if it belongs to a conversation.
- **Channel unread scoping:** channel thread SQL in
  `crates/notification/src/outbound/entity_notifications.rs` lists event types by
  name. Add a channel-scoped kind there, with tests beside it.

## 8. Docs

Update the [app agent guide](../agent-guide/README.md) page for the surface where
the notification appears (`channels.md`, `home.md`, `notifications.md`, ...).

## Compatibility and observability

- **Deploy order.** Readers skip rows they can't decode: REST lists and the digest
  drop them with a warning, and the web ignores unknown tags. A single
  `GET` by id errors, and the document storage service's realtime consumer
  rejects unknown kinds. Ship the variant in the same change as its producer, and
  don't let a separately released producer emit before `notification_service` and
  `document_storage_service` are deployed.
- **Renaming.** Keep the old tag readable with `#[serde(alias = "<old>")]` on the
  variant and a migration rewriting `notification.notification_event_type` and
  `user_notification_type_preference.notification_event_type`. Copy
  `crates/macro_db_client/migrations/20260618152324_rename_call_started_notification_type.sql`
  (generate the file with `sqlx migrate add`; see the
  [database guide](../development/database.md)).
- **Privacy.** Never put notification payloads on spans or in logs. Use
  `#[tracing::instrument(skip_all, fields(...))]` with ids and the type name only;
  `ret` and default argument capture leaked payloads and were fixed twice. See the
  [observability rule](../../.agents/rules/observability.md).
- **Malformed messages.** Ingress acknowledges and drops messages it can't decode;
  don't rely on SQS retries to fix a bad payload.

## Verify locally

```sh
cargo test -p model_notifications
cargo test -p notification_service
cargo test -p graphql_notification
cargo test -p <producing crate>          # with SQLX_OFFLINE unset
cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql
cd apps/web && bun run gen-api --check && bun run check
cd packages/sdk && just check && just coverage
```

Then trigger the event on a local stack ([running locally](../development/running-locally.md))
and confirm the row in the inbox, its click target, the live update in a second
tab, and the settings toggle. The `live-debug` skill shows the ingress and egress
spans; local-e2e notification tests live in
`crates/integration_tests/local_e2e/tests/channel_mutations.rs`.

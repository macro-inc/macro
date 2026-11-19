# Channels local sync: server contract

This is the fixed contract between the server work and the device cache engine / web work
(owned by `channels-local-sync`). Names in this file are binding; ask before changing one.

## 1. Change sequence (per channel)

Tables (copy `crates/macro_db_client/migrations/20261006230258_calendar_change_log.sql`):

- `channel_change_counters(channel_id uuid PRIMARY KEY, seq bigint NOT NULL CHECK (seq >= 0), updated_at)`
- `channel_change_log(channel_id uuid, seq bigint CHECK (seq > 0), kind smallint, message_id uuid NULL,
  activity_id uuid NULL, created_at timestamptz DEFAULT clock_timestamp(), PRIMARY KEY (channel_id, seq))`
  plus an index on `created_at` for retention. No foreign keys (same reasoning as calendar).

Kinds: 1 `message` (message_id set: the message was posted, edited, tombstoned, reacted to, or its
thread state changed), 2 `activity` (activity_id set: a system row shown in the channel timeline was
recorded), 3 `reset` (no id: the channel's history was rewritten in bulk, e.g. a historical import;
clients drop what they hold for the channel).

Rules:

- Only `MessageParent::Channel` parents take a sequence. Documents, initiatives, CRM and call parents
  must execute exactly the statements they execute today.
- One committed change = one log row = the next `seq` for that channel, taken in the same transaction
  as the change, as the **last** statement before commit (so the counter row lock is held for the
  shortest time). One statement: upsert-increment the counter and insert the log row from its
  `RETURNING`.
- A thread delete (root and replies tombstoned) logs one `message` row for the root.
- An idempotent no-op (reaction add that changed nothing) logs nothing.
- Order of `seq` within a channel equals commit order.
- System rows (`activity_events` shown by `CHANNEL_TIMELINE` in `crates/messages/src/domain/ports.rs`)
  must reach the log at least once, including after a consumer redelivery or a crash between the
  insert and the log append. Duplicates are fine (clients upsert).
- A channel call ending or its record being deleted changes how its call-root message renders
  (`CallEntryStatus`): that must log a `message` row for the call root.
- Retention: rows older than 30 days are pruned in batches (copy calendar's prune job and constants).
  `floor` = highest pruned seq for the channel (0 when nothing was pruned).

Push: the existing connection-gateway `message_update` event gains a top-level `seq` (number, the
log row the change took; absent for non-channel parents and for typing). The existing
`timeline_activity` event gains `seq` per activity (shape: `activities[i].seq`), when it was logged.
No other change to either payload.

## 2. GraphQL (all under `user { ... }`, flattened onto `GraphqlUser` like calendar)

All reads use the **primary** database (REST does; the replica lags 1-9 s and would hide a person's
own message). Authorization is exactly REST's for the same read (channel view access).

```graphql
"Opaque position of an entry in its channel timeline or thread; compares bytewise in display order."
# roots and activities: 20-digit zero-padded microseconds since epoch of created_at/occurred_at, "-", lowercase uuid
# replies: import_order as 20-digit zero-padded decimal, or "~" when null; "-"; then the same micros-uuid form
# (this reproduces ORDER BY (created_at, id) for roots and (import_order NULLS LAST, created_at, id) for replies)

input ChannelTimelineInput {
  channelId: ID!
  limit: Int            # default 50, clamped 1..=100
  before: String        # sortKey; entries strictly older
  after: String         # sortKey; entries strictly newer
  around: ID            # message id (a reply resolves to its root); window centred on it
}                       # at most one of before/after/around

type GraphqlChannelTimelinePage {
  entries: [GraphqlChannelTimelineEntry!]!   # newest first, exactly REST's order
  olderCursor: String                        # sortKey to pass as `before`; null when nothing older
  newerCursor: String                        # sortKey to pass as `after`; null when nothing newer
  seq: String!                               # channel sequence read BEFORE the page (decimal string, "0" if none)
}

union GraphqlChannelTimelineEntry = GraphqlChannelMessage | GraphqlChannelTimelineActivity

type GraphqlChannelMessage {
  id: ID!
  channelId: ID!
  threadId: ID                 # root id for replies; null on roots
  kind: GraphqlChannelMessageKind!   # MESSAGE | CALL_ROOT
  sortKey: String!
  senderId: String!
  guestName: String
  importedAuthorName: String
  botProfile: GraphqlChannelBotProfile        # { name: String!, avatarUrl: String }
  mentions: [GraphqlChannelMention!]!         # { entityType: String!, entityId: String! }
  triggeredBy: String
  triggeredVia: String
  content: String!
  createdAt: String!           # RFC 3339 with full stored precision (microseconds)
  updatedAt: String!
  editedAt: String
  deletedAt: String
  attachments: [GraphqlChannelAttachment!]!   # { attachmentId: ID!, entityType: String!, entityId: String!, width: Int, height: Int, createdAt: String! }
  reactions: [GraphqlChannelReaction!]!       # { emoji: String!, users: [String!]! }
  thread: GraphqlChannelThread                # roots only; null on replies
  call: GraphqlChannelCallStatus              # CALL_ROOT only: { state: LIVE | ENDED | RECORD_DELETED, endedAt: String, durationMs: Float }
}

type GraphqlChannelThread {                   # no `id`: embedded in its root
  resolved: Boolean!
  deletedAt: String                           # whole-thread deletion
  createdAt: String!
  updatedAt: String!
  userId: String!
  replyCount: Int!
  latestReplyAt: String
  preview: [GraphqlChannelMessage!]!          # oldest three live replies, as REST
}

type GraphqlChannelTimelineActivity {
  id: ID!
  channelId: ID!
  sortKey: String!
  actorId: String!
  occurredAt: String!
  action: String!
  payload: JSON                                # the stored payload, as REST
}

input ChannelThreadInput {
  channelId: ID!
  rootId: ID!
  limit: Int            # default 50, clamped 1..=100
  before: String        # reply sortKey; replies strictly before it in display order
  after: String
  around: ID            # reply id
}

type GraphqlChannelThreadPage {
  root: GraphqlChannelMessage!                 # with `thread`
  replies: [GraphqlChannelMessage!]!           # display order (oldest first), live replies only, as REST
  olderCursor: String
  newerCursor: String
  seq: String!
}

input ChannelChangesInput {
  channelId: ID!
  after: String!        # the client's last applied seq, decimal
}

type GraphqlChannelChanges {
  resetRequired: Boolean!   # `after` is below the floor, a `reset` row follows it, or more than 1000 rows follow it
  seq: String!              # the sequence this page reaches; on reset, the current counter
  hasMore: Boolean!         # more changes follow `seq`; ask again with after = seq
  messages: [GraphqlChannelMessage!]!            # CURRENT state of each changed message, tombstones included.
                                                 # A changed reply is listed together with its root (with `thread`).
  activities: [GraphqlChannelTimelineActivity!]!
  removedIds: [ID!]!        # logged ids that no longer exist at all (hard-deleted rows)
}

# on GraphqlUser:
channelTimeline(input: ChannelTimelineInput!): GraphqlChannelTimelinePage!
channelThread(input: ChannelThreadInput!): GraphqlChannelThreadPage!
channelChanges(input: ChannelChangesInput!): GraphqlChannelChanges!
channelMessage(channelId: ID!, messageId: ID!): GraphqlChannelMessage   # REST items/<id>; null when not found
```

Page size of `channelChanges`: at most 200 log rows per page (distinct ids hydrated once). More than
1000 rows behind = `resetRequired` (cheaper to reload the latest page than replay).

Deleted roots: REST leaves a tombstoned channel root out of the timeline unless it still has a live
reply. GraphQL pages do the same. `channelChanges` returns the tombstone (with `deletedAt` and
`thread.replyCount`) so the client can take it out of its index.

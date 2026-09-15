# Channel messages and document discussions on one store

Channel messages and document comments share one message implementation:
`comms_messages` holds the content, `comms_message_threads` holds root-level thread
state, and `crates/messages` owns the use cases for both parents. This document
describes what is live after the messages crate PR and what the remaining PRs of
the staged rollout add.

## Identity and storage

A message has one parent: `{type: "channel" | "document", id: string}`, stored in
`parent_entity_type` / `parent_entity_id`. A root message has no `thread_id`;
replies point to their root. Historical document ids are plain strings, so
`parent_entity_id` is text and document access for non-UUID ids is resolved from the
document and share tables directly.

`comms_message_threads` holds one row per root: owner, resolution, an optional anchor,
import metadata, and whole-thread deletion. An anchor is a tagged Markdown mark, PDF
highlight, or PDF placeable and is only valid on document roots. Deleting a root
tombstones that message and keeps the discussion. Deleting the discussion tombstones
every message in it, removes a comment-only placeable, detaches a highlight, and keeps
a Markdown anchor on the tombstone so an open editor can reconcile the mark.

Integrity rules that the database cannot express declaratively live in the domain
service and are covered by its tests: the parent must exist and not be soft-deleted,
a reply must target a live root of the same parent, replies cannot be replied to,
tombstoned messages are immutable, and anchors are accepted on document roots only.
The store re-checks the live-root rule inside the write transaction. The schema adds
a composite thread foreign key, a `CHECK` that forbids anchors on channel threads, and
a partial unique index for one live Markdown discussion per mark per document.

### Transitional shape

Until the last PR of the rollout removes them, the schema keeps:

- `comms_messages.channel_id` and `comms_attachments.channel_id`, nullable, filled for
  channel parents by the messages crate and by the channel writers that still exist.
  A `BEFORE INSERT` shim keeps the two representations of a channel parent in step
  for writers that only set one of them.
- An `AFTER INSERT` trigger that creates the thread row for roots inserted by writers
  that know nothing about `comms_message_threads`. The messages crate inserts the row
  itself with `ON CONFLICT`, so the trigger can be dropped without changing it.
- The legacy `Comment`, `Thread`, and `ThreadAnchor` tables and the PDF anchors'
  bigint `threadId`. New document discussions reference PDF anchors through the
  nullable `root_id` columns; `PdfPlaceableCommentAnchor` rows carry exactly one of
  `threadId` or `root_id`.
- The empty `migrated_comment_id` and `migrated_comment_thread_id` tables that the
  import fills; `resolve_legacy` reads them and returns not-found until then.

## One message API

`/messages/{parent_type}/{parent_id}` serves both parents: timeline with cursors,
centered windows, selected roots, anchored filters, activity windows, and optional
whole-thread tombstones; item read, patch, delete, and reactions; thread read, patch
(resolve, reopen, detach a Markdown anchor) and delete; typing; and old-link
resolution. Requests are authorized with `entity_access` receipts: `MessageView`
accepts any view permission, `MessageWrite` requires comment access on a document or
membership in a channel. Bots carry their verified scope in the receipt, and an
autonomous webhook bot is authorized by its channel membership alone.

References are validated before persistence. Documents, channels, chats, projects,
email threads, calls, calendar events, agent sessions, and CRM records require view
access for the author; users and bots must be canonical principals; static media is
readable by anyone who has its id; `@here` is expanded server-side from current channel
membership. Display-only editor chips (dates, contacts, colors, automations) are
stored as written, as the channel writer always did, because they name nothing that
can be authorized.

## The channel routes are adapters

Every existing `/channels/{id}` message, reaction, and typing route, its request and
response shapes, and its OpenAPI operation id are unchanged. The write handlers
translate the old request into the shared `MessageCommands` through
`ChannelMessageAdapter`; so do the channel bot webhook, the agent's
`SendChannelMessage` tool, the Macro AI reply loop, and the support-channel welcome
message. Channel reads still use the channel repository, which reads `channel_id`.
The `ChannelService` write methods remain on the trait for their tests and are
removed with the routes in the last PR.

## Delivery

A committed change fans out to three independent sinks; a failure in one is logged
and never turns the committed write into an error:

- The broker sink publishes parent-aware facts on `macro.messages`:
  `message.posted`, `message.patched`, `message.deleted`, `message.mentioned` (one
  per mentioned entity), `message.attachment_created`, and
  `message.attachment_removed`, keyed by root id. Reactions and typing stay off the
  topic. Payloads carry the parent, message and root ids, sender, and the same
  fields as the channel-only events, minus `channel_type`.
- The local built-in agent queue. In this stage the Macro AI trigger still arrives
  through the channel side effects below, so this sink is a no-op until the agent PR
  moves detection onto the message facts.
- Parent delivery. For channels, `ChannelMessageDelivery` dispatches the same
  `ChannelEvent`s the old writer dispatched, so notifications, activity, sharing of
  referenced items, contact sync, search indexing, bot triggers, and the
  `comms_message` / `comms_attachment` / `comms_reaction` / `comms_typing` realtime
  payloads the deployed client listens to are unchanged, and the `channel.*` events
  on `macro.channels` keep flowing. It also sends the common `message_update` payload
  to channel participants. For documents, `DiscussionDelivery` sends `message_update`
  to current viewers and the existing document comment notifications (mention, reply,
  assignee, owner) to recipients whose view access is rechecked at delivery time.
  Comment notifications now identify the comment by message id, so the metadata's
  `commentId` / `threadId` accept either a legacy number or a message UUID.

## What each remaining PR adds

1. Comment import: an online, idempotent copy of `Comment` / `Thread` rows into the
   shared store, filling the legacy-id mapping tables and the PDF anchors' `root_id`.
2. Frontend: the shared message queries, cache, and thread components mounted on both
   surfaces behind a flag, consuming `message_update` and the new routes.
3. Parent-aware agents: trigger detection, session origins, history, and reply
   delivery on `message.posted`; the local agent sink replaces the channel trigger.
4. References: documents list the channel threads that mention them.
5. Contract: drop the legacy comment tables and handlers, `channel_id`, the shim
   triggers, the old channel message routes, and the `channel.message_*` broker
   events; search, webhooks, and soup move to `macro.messages`; SDK major bump.

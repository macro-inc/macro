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
- The local built-in agent queue: every human-authored post, on either parent, is
  handed to the in-process Macro AI detector (see Agents below). Bot posts never
  enter it, so bots cannot trigger each other.
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

## Agents

Every committed post publishes `message.posted` with the persisted parent, the message
and root ids, the sender, mentions and attachments, and the verified triggering user.
Agent invocation reads that fact and never requires a channel id.

Hosted and external agents:

1. The trigger consumer verifies the sender's current ability to write to the parent
   (channel membership or document comment access) and mints an invocation capability
   bound to that parent and root. Agent availability is checked next: system agents
   are global; a document permits the caller's own private or team agents; a channel
   keeps its installation rules for selected agents and legacy agent bots.
2. An existing session is resumed only when it was opened from the same parent and
   root. Explicit reply references and follow-up mentions cannot select another
   conversation's session. Otherwise a session is created for this root, and its
   `thread_parent` is derived from the root message rather than stored.
3. History is read through the message service under the invocation capability,
   downgraded to view access. Document history stays inside its discussion; channel
   history may include the preceding channel messages. The composed prompt names the
   parent so document tools can address the enclosing document.
4. The harness rechecks the sender's access before provisioning and again at
   dispatch, then announces the session as the bot into the same thread through the
   message service with a capability minted on the invoking user. Session origins,
   queued prompts, external webhook payloads, and coding-worker origins carry the
   parent.

A document collaborator inherits session viewing from document viewing, and session
editing from document commenting or editing; the session owner keeps explicit
ownership, and other collaborators lose inherited access when the document grant is
revoked. Realtime session frames are addressed through the same current access.

Classic `@Macro` runs in the storage service on the local agent queue for both
parents. It rechecks the invoking user's write access before reading context, posts a
silent thinking message as the bot on that user's capability, and patches it into the
answer with normal notification delivery. A deleted placeholder or revoked access
prevents publishing the answer.

### Trigger event transition

The trigger consumers can read either `message.posted` on `macro.messages` (the
default) or the pre-parent `channel.message_posted` on `macro.channels`, selected by
`AGENT_TRIGGER_EVENT_SOURCE`. Only one source is read at a time: the storage service
publishes every channel post on both topics, so reading both would evaluate each
channel mention twice. The channel source stays available as a rollback until PR 7
retires the `channel.message_*` events, at which point it is removed.

Agent-session trigger events on `macro.agent_sessions` stay at schema version 1. A
channel-parent trigger keeps the shapes every consumer already decodes
(`top_level_mentioned` and `channel`, embedding the channel-only post with its
`channel_type`, which the trigger reads from the channel when `message.posted` did not
carry it). A document-parent trigger travels in the new `mentioned` and `thread`
variants, which consumers built before message parents drop as undecodable. Old
replicas and user-run macrod daemons therefore keep serving channel mentions through a
deploy; only document mentions wait for them to roll. Lifecycle events keep their
schema too: `ThreadOrigin` gains `parent` and its `channel_id` becomes optional, and
older origins without a parent decode as channel origins.

## What each remaining PR adds

1. Comment import: an online, idempotent copy of `Comment` / `Thread` rows into the
   shared store, filling the legacy-id mapping tables and the PDF anchors' `root_id`.
2. Frontend: the shared message queries, cache, and thread components mounted on both
   surfaces behind a flag, consuming `message_update` and the new routes.
3. Parent-aware agents (this document's Agents section): trigger detection, session
   origins, history, and reply delivery on `message.posted`; the local agent sink
   replaces the channel trigger.
4. References: documents list the channel threads that mention them.
5. Contract: drop the legacy comment tables and handlers, `channel_id`, the shim
   triggers, the old channel message routes, and the `channel.message_*` broker
   events; search, webhooks, and soup move to `macro.messages`; SDK major bump.

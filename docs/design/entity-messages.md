# Document discussions and channel messages

This release replaces the separate document Comment/Thread store with shared
messages. It also moves agent invocation, session origins, history, and answer
delivery onto the same parent-aware model. Email comments are outside this change.

The [implemented simplification](entity-messages-simplification.md) shows the current
dependency DAG and the shared API, reader, client, cache, and thread UI. The earlier
[dependency cleanup](entity-messages-dependencies.md) is historical context.

## Identity and storage

A message has one parent: `{type: "channel" | "document", id: string}`. A root
message has no `thread_id`; replies point to that root. A reply cannot cross parents
or point at another reply. `comms_messages` stores both kinds of conversation, with
shared attachments, mentions, reactions, author attribution, and timestamps.

`comms_message_threads` holds root-level state: creator, resolution, optional anchor,
and deletion. An anchor is a tagged Markdown mark, PDF highlight, or PDF placeable.
Deleting a root tombstones that message and preserves the discussion. Explicitly
deleting the discussion removes its replies and comment-only anchors. Independent
PDF highlights survive.

## One message API and implementation

`crates/messages` owns timeline, individual-message, thread, post, edit, delete,
reaction, thread-state, and typing use cases. Its domain service receives typed
parent access capabilities. SQL and transaction mechanics live in its outbound
repository. Delivery is composed through ports.

Both surfaces use `/messages/{parent_type}/{parent_id}` with item, thread, reaction,
typing, reference, and old-link resolution subroutes. The old channel message routes
and request/response adapters are removed. Channel APIs retain channel metadata,
membership, lists, and specialized selection such as inbox ranking. Those readers
use indexed parent predicates directly; the channel compatibility views are gone.

Timelines have cursor pagination and three reply previews per root; full replies
load on opening the thread. The frontend generalizes the existing channel mutations,
optimistic reconciliation, and realtime cache updates to a parent. Native document
messages render through the shared message/thread components, without converting to
`DiscussionComment`. Linked drawers and ReplyTarget references accept either parent;
existing channel-only reference serialization is understood on read.

Reference authorization accepts the editor's email `thread` tag (alongside `email`
and `email_thread`), calls, and calendar events through their existing access rules.
This does not make emails message parents. Channel composers preserve `@here` as
one authored group reference. The server resolves current active human members for
delivery after applying the 100-authored-reference budget. Thread-participant reads
also recognize that group using current membership. The 10-attachment limit and
entity authorization still apply.

## Agents

All committed posts can publish `message.posted` on `macro.messages`. The event
contains the persisted parent, message/root identity, sender, references, and verified
triggering user. Trigger consumers no longer require a channel ID.

For hosted and external agents, the flow is:

1. Verify the requesting user's current ability to write to the parent, then verify
   agent availability. A document permits globally available system agents and the
   caller's available private/team agents. Channel installation remains relevant
   for channel conversations.
2. Resolve an existing session only within the same parent and root. Explicit
   reply references and follow-up mentions cannot select another conversation's
   session. Otherwise create a session tied to this root.
3. Read current authorized context. Document history stays inside its discussion;
   channel history can include nearby preceding messages. The prompt includes the
   document/channel identity, so document tools can address the enclosing document.
4. Provision/dispatch the agent and announce its session in the original thread.
   Session origins, queued prompts, and external webhook payloads retain the parent.
5. Recheck current access before subsequent prompts and answer delivery. Answers
   are authored as the bot through the common message API in that same thread.

Classic `@Macro` uses the same parent-aware message service and current access
boundary. It posts a silent thinking message and edits it into the final answer
with normal notification delivery. Deleted placeholders and revoked access prevent
publishing the final answer. Only human posts enter its local trigger queue, avoiding
self-trigger loops. Explicit and inferred follow-ups use the discussion history.

A document collaborator inherits session viewing from document viewing, and session
editing from document commenting/editing. The session owner retains explicit ownership;
other collaborators lose inherited access when the document grant is revoked.
Realtime session audiences are filtered through current session access as well.
Linked conversation drawers acquire and heartbeat their source parent while open,
even when that document is closed. The connection client reference-counts ownership
with document blocks and reopens all tracked parents after reconnection. Closing
one view cannot close another view's subscription.

## Combined context

`GET /messages/document/{id}/references` discovers channel threads whose current
structured mentions reference this document, deduplicates by root, and authorizes
source-channel viewing before exposing their identities. A mention grants no access.
The response includes only the source parent/root, name, and current reply capability;
the common message reader and cache own the source's content.

The document Discussion offers `Include channel mentions`, initially off. Source
threads retain their channel parent, links, and permissions. Reply/edit/delete/react
operations go to that source; new document discussions still go to the document.
Whole-discussion resolution/deletion controls apply to document discussions. Queries
refresh on relevant realtime events, reconnection, and periodically while enabled.

## Notifications and delivery

The shared persisted parent determines notification language and recipients. Document
posts remain document comment/reply/mention notifications. Channel messages retain
channel notification behavior. Bot display names and avatars survive the document
notification path. Notification policy is trusted server input, not client-controlled
JSON; bot attribution comes from the verified principal and acting-user scope.
Human reaction additions and removals update channel activity using the reacting
actor. Activity failures do not suppress the committed reaction's live delivery.

Persistence commits before realtime and event delivery. Failed delivery is logged and
does not turn a successful write into a retry-inducing error. This change does not
introduce a durable outbox: an unavailable broker can miss an agent trigger. UI
reconnect/refetch recovers transient missed display updates; it does not replay agents.

## Coordinated cutover

See [the operator runbook](../../scripts/message-cutover/README.md). A Rust binary
prepares stable UUIDv7 mappings and executes the final import transaction. Tests seed
comments on the pre-migration schema before running the actual migrations. Historical
notification IDs, PDF references, deleted roots, replies, empty threads, and old links
are covered. The legacy Comment/Thread tables are dropped at cutover.

There is no dual-write period, separate compatibility store, or Loro migration.
Markdown mark IDs match the new thread anchors directly; stored snapshots and history
are not rewritten. The editor format increment only describes newly serialized
parent-aware references. Old numeric links resolve through immutable mapping tables.

Writers must be paused, old trigger events drained, the new Kafka topic provisioned,
and matching backend/frontend/consumer versions deployed together. Reverting the app
alone is not a rollback; restoring the old schema requires the matching database
snapshot and application artifacts.

## Verification on 2026-09-06

- `just prepare_db` from the root Nix shell completed the workspace database check
  and regenerated SQLx query metadata. The root `just clippy` gate passed.
- The full frontend `bun run check` passed after OpenAPI/GraphQL generation.
  All 200 Lexical tests passed, including document/channel ReplyTarget context.
- Rust suites passed for messages (34), channels (324), bots (82), classic message
  agents (16), trigger routing (52), sessions (127), harness logic (143), external
  coding worker (48), webhooks (181), and entity access (430). Affected service,
  AI tool, and migration suites also passed.
- The six Rust cutover tests start before the migrations, seed legacy comments,
  execute both migrations, and verify preserved data and new writes. The query-plan
  regression adds 30,000 unrelated channel/document messages and checks that timeline
  and batched latest reads use channel-scoped index conditions.
- Four frontend subscription regressions cover source tracking and heartbeats,
  either view closing first, changing source parents, and reconnection.
  Chrome on instance `messages` also verified a second collaborator's replies,
  edits, and reactions arriving in the actual linked drawer with no source document
  open. Captured WebSocket frames show source `open`/`ping` and final-owner `close`;
  closing the drawer preserved live updates in a simultaneously mounted preview.
- Two frontend routing tests verify source-channel mutations and read-only sources.
  Chrome on custom instance `messages` verified real discussion posts, reactions,
  replies arriving in another tab, edits, resolution/reopening, and root tombstones.
  A reply sent from the combined document view appeared in the original channel;
  the stored message retained the source parent and root ID.
- The browser displays the document agent mention menu. A real model-backed answer
  was not verified: this local environment has no Doppler token/model credentials.
  Agent context, authorization revocation, session matching, and reply delivery have
  automated coverage. Browser verification of an actual model answer remains open.

## Dependency cleanup verification on 2026-09-07

- Rust tests passed for `messages`, `channels`, `comms_db_client`, `bots`,
  `channel_bots`, `agent_trigger`, `agent_harness`, `authentication_service`, and
  `document_storage_service`. Coverage includes actor/parent/root-bound invocation
  capabilities, revoked access, deleted threads, independent delivery failures,
  attachment patches, and 300-member group mentions. Database tests verify group
  participant reads and filters before and after a member leaves.
- Root Nix `just prepare_db` regenerated SQLx metadata successfully; root
  `just clippy` passed. Dependency metadata and storage OpenAPI/client generation
  were refreshed. This cleanup changes no migration or Loro data.
- Frontend composer, payload, presentation, routing, subscription, and Lexical
  mention tests passed. Failed sends preserve the draft and attachments, duplicate
  pending sends are blocked, and reaction activity does not fabricate an edit
  timestamp. The final full frontend `bun run check` passed GraphQL cache schema,
  TypeScript, and Biome checks.
- Chrome against the rebuilt storage service on instance `messages` verified a
  deliberately failed document comment send retained its draft and a retry sent
  it once. A reaction preserved `edited_at: null`; editing the comment set its
  actual edit timestamp. Browser evidence is in
  `/tmp/macro-message-agents-demo/untangle-document.json` and the adjacent screenshot.
- The actual channel composer sent and persisted one `group:here` reference.
  Replying from the document's combined view supported the same group mention and
  retained the source channel and thread root. Evidence is in
  `/tmp/macro-message-agents-demo/untangle-channel.json` and
  `/tmp/macro-message-agents-demo/untangle-combined.json`, with adjacent screenshots.
- With the source document closed, the linked drawer opened and heartbeated its
  source subscription and displayed live replies, edits, and reactions. A separate
  collaborator's mutations also arrived live. Evidence is in
  `/tmp/macro-message-agents-demo/review-drawer.json` and
  `/tmp/macro-message-agents-demo/review-drawer-collaborator.json`.
- Hexagonal boundaries were checked: authorization, message lifecycle, reference
  validation, group audience selection, and notification policy remain in domain
  services. Composition roots wire concrete infrastructure; adapters translate
  requests or deliver effects. The earlier limitation on verifying a real
  model-backed agent answer still applies.

## Consolidation verification on 2026-09-09

The [current architecture and DAG](entity-messages-simplification.md) replace the
parallel paths described in the earlier verification sections.

- Root Nix `just prepare_db` passed across the workspace and regenerated SQLx
  metadata. Root `just clippy` passed, including sync-service. The final storage,
  authentication, and agent-harness binaries built successfully.
- Affected Rust suites passed, including messages (40), channels (240), inbox/soup
  (255; two existing ignored tests), agent/session/trigger integrations, bots,
  document readers, and the affected services. The shared reader covers built-in
  bot identities and soft-deleted bot profiles. Delivery tests verify that reaction
  activity and notification/search effects survive independent live-delivery failures.
- All six Rust cutover tests passed after removal of the compatibility views. They
  seed the pre-migration schema, migrate existing comments, verify preserved anchors,
  roots/replies/empty threads and old links, and exercise new writes. Indexed query
  plans remain covered with 30,000 unrelated messages present.
- Full frontend `bun run check` passed. The 173 selected frontend tests passed,
  covering optimistic mutations, timeline/selected-root/reply reconciliation,
  imported ordering and attribution, composition, and source subscriptions. Thirteen
  cache persistence tests also passed.
- Chrome on custom instance `messages` verified document post/edit/react/reply using
  the shared API; reactions preserve the actual edit timestamp. The combined view
  retained an in-progress draft and focus while its source was edited and reference
  discovery refreshed. Its `@here` reply appeared in the original channel, with the
  original channel parent and root ID.
- With the document closed, the linked drawer opened and heartbeated the source
  subscription. A separate collaborator's post, edit, and reaction arrived live.
  The document composer displayed the shared agent mention menu.

The 41-second recording is `/tmp/macro-message-consolidation-demo/unified-discussions.mp4`;
its adjacent `index.html`, JSON evidence, and `run-notes.md` describe the checks.
Pauses between checks are shortened. This video does not film the migration.
A real model-backed agent answer remains unverified locally: the environment lacks
provider credentials and the required harness configuration. Automated invocation,
access, history, session-context, and reply-delivery coverage passed.

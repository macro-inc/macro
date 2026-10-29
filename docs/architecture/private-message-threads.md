# Private message threads

Ephemeral agents start durable private exchanges. “Ephemeral” describes their
message audience, not retention: the initiating user can revisit the whole
thread and the agent's replies in their channel history.

## Audience

`agent_configs.is_ephemeral` controls the default for a new mention. Creating a
message with `PostMessage.ephemeral` also selects a private audience without
requiring an agent. The message service resolves mentioned agent settings through
`EphemeralAgentReader`, implemented by the bots repository. Every writable
composition supplies this reader; an unconfigured service rejects persisted-agent
mentions rather than guessing whether they may be public.

`MessageVisibility` is either `public` or `private` with the initiating `user_id`
and canonical `bot_ids` invited by the initial mention. These fields are selected
from authenticated capabilities, never accepted as client audience claims. A
bot reader must have a verified acting user matching the initiating human.
Channel and team receipts, parent owners, moderators, and other channel members
do not gain private-thread access.

The audience is immutable. Replies inherit it in the message service and in a
Postgres insert trigger, including replies submitted by older writers. Explicit
private writes with a different thread audience are rejected before persistence.
A private reply to a public thread starts a separate private root. Editing a
message keeps its original audience; public edits cannot introduce an ephemeral
agent and require a new private thread instead. Changing an agent's setting
affects future threads only; older clients that omit the setting on an agent
update preserve its saved value. Private roots are unanchored: shared document
marks and the call's one canonical chat thread cannot carry them.

## Reads and delivery

The shared message service checks the audience for individual reads, threads,
edits, reactions, typing, and deletions. Timeline queries carry an internal,
server-selected viewer and filter in SQL before pagination, centered windows,
counts, and previews. Agent context may include public channel history and the
target private thread; it excludes every other private thread, including other
requests to the same agent.

Private channel events reach only the initiating user through targeted realtime.
They do not share referenced documents with the channel, notify other members,
send invitation emails, or advance shared channel activity. Private discussion
events likewise skip mention sharing and notifications. Shared channel, Soup,
reference, attachment, and message-search projections exclude private content.
Private exchanges remain available in the initiating user's channel history and
personal favorites. Agent-session transcript search retains personal access
grants, so other users cannot discover the private exchange.

Only the parent-aware posted broker fact carries private content for agent
execution. It includes the audience; derivative public mention, attachment, edit,
and deletion facts are suppressed. Agent routing checks the invited bot and
bypasses the ordinary agent-DM conversation session. New private sessions do not
receive a channel grant or inherit document access. Trigger webhooks, private
message SSE, and private session lifecycle events use only the initiating
personal workspace, without team or parent expansion. Ordinary channel-message
webhooks and event routines do not receive private posts.

Session storage copies the immutable audience at creation and retains it after
root deletion. Lifecycle identities carry this audience independently of origin
metadata; missing audience fails closed. Private sessions cannot be shared
through settings or human mentions, and lifecycle notifications are suppressed.
Storage rejects non-owner grants from generic access requests, direct sharing,
and inherited folder, team, or channel access.

## Interface

Agent settings expose **Ephemeral agent** under **Message privacy**. The channel
composer shows **Everyone** or **Only you** before sending. Mentioning an
ephemeral agent selects and locks **Only you**; removing the mention retains the
private draft choice until the user changes it. Private replies stay locked,
and a private reply to a shared thread explains that it starts a private thread.
Sent messages carry an **Only you** lock label on desktop and touch layouts.
The manual privacy choice is saved with the draft and restored after send errors.

## Release and verification

The additive migration is compatible with existing writers. Deploy every backend
reader/consumer and refresh generated clients before releasing the checkbox or
creating ephemeral agents/private messages. Older consumers cannot enforce the
new audience and must not coexist with enabled private-message writes. Do not
create private data during a rolling backend deployment.

Exercise the message/bots/channel/trigger/webhook domain tests and the message
repository database regressions. The backend-free desktop/phone control check is:

```sh
bunx playwright test --config src/features/channel/Input/browser-test/privacy.playwright.config.ts
```

A full local-stack check uses two authenticated channel members: the initiator
can send, reopen, and receive an agent reply, while the other member cannot fetch
the root/replies by id, see realtime content, find the exchange in shared search,
or receive a notification. Use a local backend containing this implementation;
the deployed development backend cannot validate new fields before deployment.

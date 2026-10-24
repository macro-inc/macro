# WhatsApp linked devices

Personal WhatsApp accounts linked to Macro as devices. Each person connects
their own account (QR), adopts groups they already belong to, and each adopted
group becomes an independently shared `whatsapp_group` entity. Each person sends from their own
account. Ported from the domain logic of #8304; the Go session service and its
HTTP API were replaced.

## Processes

```
Web app ──REST──▶ DSS ──── MacroDB ◀──── whatsapp_session_service (N replicas)
                         rows + NOTIFY      one task + one client per leased account
```

- **DSS** serves `/meta/linked/*` (`crates/whatsapp_linked/src/inbound`),
  authorizes people, writes group entities and intents, and publishes generic notifications.
- **Session service** holds each account's advisory lock, runs the WhatsApp
  socket, and calls `whatsapp_linked::domain::session::SessionService`
  in-process. There is no service-to-service HTTP.

Every payload is JSON `{"id": "<uuid>", "traceparent": "…"}` (`whatsapp_changed`:
`{"scope": "groups", "account_id"}` or `{"scope": "group", "group_id"}`, plus
`traceparent`), so the receiver's span joins the sender's trace.

| Signal | Id | Sent by → read by | Meaning |
| --- | --- | --- | --- |
| `whatsapp_pairing_requested` | pairing | DSS → session | start, update or stop (cancelled) pairing |
| `whatsapp_send_requested` | account | DSS → session | claim pending sends |
| `whatsapp_groups_requested` | account | DSS → session | refresh the account's group list (at most every 30 s) |
| `whatsapp_account_changed` | account | DSS → session | consent or adopted groups changed; re-read |
| `whatsapp_account_released` | account | session ↔ session | lease handed over |
| `whatsapp_group_effects` | message | session → DSS | a group notification revision is ready |
| `whatsapp_media_ready` | document | session → DSS | attachment bytes are ready to import |
| `whatsapp_changed` | scope | session/DSS → DSS | something a page shows changed; DSS pushes it |

## Ownership and fencing

`whatsapp_linked_account.lease_epoch` is bumped by `begin_lease` when a replica
takes an account. Every session-service write locks the account row at that
epoch; a stale epoch fails with `Fenced` and the replica must stop the account.
`generation` is separate: it counts explicit consent (pairing, disconnect,
logout) and fences memberships and send intents.

## Pairing

DSS `connect` creates or reuses the person's account (`pairing`, generation +1)
and a five-minute `whatsapp_pairing` row, then signals. The replica reports QR
or pairing codes with `update_pairing`; the browser polls `GET pairing/{id}`.
`Success` connects the account only if the identity matches a reconnect's
expected identity and belongs to no other person. Cancel and expiry end the
attempt and disconnect a pairing account. Codes are cleared when the
transaction ends.

## Groups and adoption

`whatsapp_group_roster` is each account's view of its groups. The replica
rewrites it on connect and reconnect, updates single groups from live WhatsApp
group events (joined, left or removed, name or participant changes), and
refreshes the whole list when a page asks: opening the WhatsApp page
(`GET /groups`) or a group (`GET /whatsapp-groups/{id}`) returns stored data
and signals `whatsapp_groups_requested`, which each account's runner honours
at most once per 30 s. There is no periodic refresh and no freshness rule:
adoption and can-send read the stored roster, and WhatsApp's own rejection of
a send is the final check.

Adoption (`{group_jid}`) makes the group the adopter's own entity: one live
`whatsapp_group` per (owner, WhatsApp group), so two people adding the same
WhatsApp group get two Macro groups, and adding it again returns the existing
one. No team is involved. It registers `EntityType::WhatsAppGroup`, grants the
adopter Owner through `entity_access`, and records their remote membership. The
name always follows WhatsApp: the subject, or for an unnamed group the other
members' names ("Ana, Ben, +2"), updated when the owner's account sees a
change. `GET /groups` marks each remote group with the caller's own Macro group
(`group`) or, when they have none, one shared with them by someone else
(`shared`, with its owner).

`whatsapp_chat` is each account's chat list as WhatsApp Web shows it, groups
and direct chats: name, last activity, archived and pinned, and the newest
known message (the anchor). WhatsApp's history sync right after pairing fills
it (initial, recent and full bundles; push-name bundles rename direct chats);
live messages in any chat bump activity and add new chats; contact, push-name,
archive and pin updates change existing rows. It never holds message content.
`GET /chats` merges it with the roster (the roster names groups and decides
what can be added; direct chats are listed but not addable yet), newest first.
An account paired before the list existed only gets groups and chats with new
messages: WhatsApp sends the full list once, at pairing.

Adding a group sets `backfill_state = 'pending'`. The owner's account then
imports the chat's earlier messages from the phone, on demand only: it asks for
the anchor message itself when it predates adoption (a placeholder resend) and
for pages of 50 messages before the oldest imported one (history sync on
demand), until the phone has nothing older (`done`) or 500 messages / 90 days
(`partial`). An unanswered request (60 s) means `waiting_for_phone`, retried
every 5 minutes and at once on reconnect; a chat without an anchor waits for its
first live message. Imported messages are ingested as history (origin
`history`): no notifications, no unread, deduplicated with live messages by
source id, and only into the owner's own groups, which replaces the
adoption-time boundary for them.

Viewing uses ordinary entity sharing: direct people grants and access requests
at `/entities/whatsapp_group/{id}/...`, canonical explicit team grants, link
sharing, and channel grants: mentioning a group in a channel message shares it
with the channel's current members (View), through the same reference-sharing
path as documents (`crates/channels` `ReferencedShareItemType::WhatsAppGroup`).
It requires no connected WhatsApp account or remote group membership.
The group detail includes `share_permission` and `access_level`; its `/permissions`
GET/PATCH pair drives the standard Share dialog. Only the actual owner changes
team/link policy or detaches the group. Leaving WhatsApp or disconnecting keeps
established access and history. Roster updates never create sharing grants.

## Live updates

Writes that change what a page shows signal `whatsapp_changed` in the same
transaction: a roster write that actually changed something (the account's
list, and each affected group entity), message, revision, reaction and
attachment changes, send outcomes and expiries, and detaching. DSS coalesces a
burst and pushes a bare connection-gateway message `whatsapp_changed` with
`{scope: "groups"}` to the account owner or `{scope: "group", group_id}` to
everyone who can view the group; the page re-fetches.

## Inbound, timeline and notifications

The replica keeps only events for adopted groups, persists them before ACK and
calls `ingest_event`. Unadopted events never enter storage. Every observer converges
on `(group, verified person, source id)` in `whatsapp_group_message`; messages do
not reference native comms storage. Sender associations use verified phone/LID
aliases: WhatsApp's from-me flag makes the sender the account's own identity,
and the session service fills the other half of a sender's pair from the
account's LID store (ingest also from the account's roster). Identities still
ambiguous are quarantined and retried. Missing reaction/revision targets
are deferred. Edits follow source revision order; deletes are permanent tombstones.
Reactions and media live in `whatsapp_group_reaction` and `whatsapp_group_attachment`.

Besides text and media, a message may carry structured content in
`whatsapp_group_message.rich` (`whatsapp_linked::domain::rich::RichContent`):
polls, locations, contact cards and WhatsApp events, plus `mentions` (WhatsApp
ids the text @-mentions) and `forwarded`. Poll votes are decrypted by the
replica with the poll's message secret and kept per voter in
`whatsapp_group_poll_vote` (latest revision wins); history pages bring them
already decrypted. System lines (`kind = 'system'`) record what happened in a
group: live `w:gp2` notifications (subject, description, disappearing timer,
members added, removed, left, joined by link, promoted, demoted; each gets a
stable synthetic source id), group icon changes, pins, call logs and the stub
messages of history pages (including group creation). They never notify and
never count as unread. The timeline resolves the ids in mentions, system lines
and votes to names (people seen in the group, then the roster, then the phone
number). View-once media and shapes Macro does not read stay readable
placeholders. Attachments keep WhatsApp's declared width, height and length,
and whether WhatsApp shows them as a sticker, GIF or voice note.

`GET /meta/linked/whatsapp-groups` lists shared groups with viewer-specific unread
counts and sending eligibility. Detail and messages live under
`/meta/linked/whatsapp-groups/{group_id}`. Messages page newest-first using stable
`(sent_at,id)` keysets with an opaque message-id `before` cursor. The `/read`
endpoint advances `whatsapp_group_read_state` monotonically; history and the
viewer's own messages do not increase unread counts.

DSS drains a durable notification outbox through the generic notification ingress.
`whatsapp_group_message` notifications target directly shared users, team and
channel members, and known link viewers who have read the group, except the verified sender. Link
viewers must still have access when recipients are resolved; unknown link visitors cannot be
enumerated. Notifications use the message id for idempotency and are suppressed
for history, system lines, replays, edits, reactions and poll votes. They link to the standalone group entity.
GraphQL notification targets use the canonical entity enum while groups remain outside Soup.

## Sending

DSS records a `whatsapp_send` intent (idempotency key, request digest, group
sequence, the request's `traceparent`) only while the sender's account is
connected, observing and allowed to post. A request repeating an intent key
returns the stored send, whatever changed since; a different payload with the
same key conflicts. The dispatch span joins the recording request's trace. The replica claims pending sends in group order, calls
`begin_dispatch` with the WhatsApp message id it will use (all facts are
re-checked; this is the point of no return), submits, then calls
`record_send_outcome`. An acceptance writes the group message with the
sender's identity; the later echo converges on it. A replica that dies after
`begin_dispatch` leaves the send `unknown`; it is never sent again, and a later
echo settles it. Unattempted intents expire after ten minutes. Edits and
deletes are limited to the sender's own messages for ten minutes.

## Rollout switches

DSS config `WHATSAPP_LINKED_PAIRING_ENABLED`, `WHATSAPP_LINKED_ADOPTION_ENABLED`
and `WHATSAPP_LINKED_SENDING_ENABLED` default to false. Disable sending first
during an incident. Turning switches off keeps history and access.

## Media

Inbound attachments are reserved per ordinal at ingest, with the download
locator sealed by the session service under the observing account's key. That
account's replica claims the download (`claim_media_imports`), checks the
SHA-256 and hands over the bytes (`complete_media_import`), which wait in
`whatsapp_media_blob`. DSS (signal `whatsapp_media_ready`) creates a private
document owned by the group owner. Attachment documents inherit current group
view access; sharing and revocation apply to previously imported files too. Ready
bytes are never rewritten. Failures retry with backoff and then expose an
`unavailable` attachment state; message bodies remain plain WhatsApp text.

Outbound: the attachments route stages one file per send in the blob table;
`ReplyContent::Media` names it, the replica fetches it with `outbound_media`,
and on acceptance it becomes the message's document, owned by the sender.
A text send may @-mention participants (`ReplyContent::Text.mentions`, their
WhatsApp ids; the text names each as `@<digits>`); the replica sends them as
the message's `mentionedJid`.

## Passkey pairing

When WhatsApp asks for a passkey, the replica reports `PairingUpdate::Passkey`
with the WebAuthn request options, shown as `PairState.challenge`. The owner's
native authenticator posts the assertion to `pairing/{id}/passkey`; DSS stores
it on the pairing row and signals; the replica takes it once
(`take_passkey_response`) and forwards it.

## Durable inbound

The replica persists each event with `enqueue_inbound` before acknowledging it
to WhatsApp, then ingests asynchronously with `replay_deferred`.

## Send request budget

DSS accepts at most one deliberate WhatsApp send request per second per
user, shared across groups and DSS replicas through its existing Redis rate
limiter. The domain consumes the budget before evaluating a new send (a replayed
intent key does not); requests that later fail still count. Exhaustion returns `429` with code `rate_limited` and
`Retry-After: 1`; an unavailable counter fails closed with `503`. This does not
retry a send or change its idempotency key or unknown-outcome reconciliation.

Only the person who owns a connection sends from it, using their session or their
own API credential, including a verified Macro API JWT with signed agent attribution.
The domain resolves the sending account from the authenticated person, never from
the group owner or request input. Media uploads follow the same owner policy.
Bot, harness and internal principals never send, including bots acting for a user.
Pairing reads (including QR codes and passkey challenges) and account/access
controls require the person's bearer session; API credentials cannot perform them.

## Follow-ups

- Soup/search registration is deferred; External, shared links and notifications
  are the group entry points.
- Participant receipts are stored but not shown.

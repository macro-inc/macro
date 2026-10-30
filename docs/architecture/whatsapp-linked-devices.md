# WhatsApp linked devices

The WhatsApp provider of [external chats](external-chats.md). Each person
links their own WhatsApp account as a device (QR), adds groups and direct
chats they already have, and each added chat becomes an independently shared
`external_chat` entity with provider `whatsapp`. Each person sends from their
own account. Ported from the domain logic of #8304; the Go session service and
its HTTP API were replaced. Sharing, the generic API, live updates,
notifications and attachment storage are in
[External chats](external-chats.md); this page covers the WhatsApp side.

## Processes

```
Web app ──REST──▶ DSS ──── MacroDB ◀──── whatsapp_session_service (N replicas)
                         rows + NOTIFY      one task + one client per leased account
```

- **DSS** serves `/whatsapp/*` (account, pairing, chat list;
  `crates/whatsapp_linked/src/inbound`) and `/external-chats/*`
  (`crates/external_chat/src/inbound`, with `WhatsAppProvider` from
  `crates/whatsapp_linked/src/domain/provider.rs` as its `ChatProvider`),
  authorizes people, writes chats and send intents, and publishes
  notifications.
- **Session service** holds each account's advisory lock, runs the WhatsApp
  socket, and calls `whatsapp_linked::domain::session::SessionService`
  in-process. There is no service-to-service HTTP.

Every payload is JSON `{"id": "<uuid>", "traceparent": "…"}`
(`external_chat_changed`: `{"scope": "chats", "account_id"}` or
`{"scope": "chat", "chat_id"}`, plus `traceparent`), so the receiver's span
joins the sender's trace.

| Signal | Id | Sent by → read by | Meaning |
| --- | --- | --- | --- |
| `whatsapp_pairing_requested` | pairing | DSS → session | start, update or stop (cancelled) pairing |
| `whatsapp_send_requested` | account | DSS → session | claim pending sends |
| `whatsapp_roster_requested` | account | DSS → session | refresh the account's group list (at most every 30 s) |
| `whatsapp_account_changed` | account | DSS → session | consent or added chats changed; re-read |
| `whatsapp_account_released` | account | session ↔ session | lease handed over |
| `external_chat_effects` | message | session → DSS | a message notification revision is ready |
| `whatsapp_media_ready` | blob | session → DSS | attachment bytes are ready to import |
| `external_chat_changed` | scope | session/DSS → DSS | something a page shows changed; DSS pushes it |

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

## Groups and adding chats

`whatsapp_roster` is each account's view of its groups. The replica
rewrites it on connect and reconnect, updates single groups from live WhatsApp
group events (joined, left or removed, name or participant changes), and
refreshes the whole list when a page asks: opening the WhatsApp page
(`GET /whatsapp/chats`) or a chat (`GET /external-chats/{id}`) returns stored
data and signals `whatsapp_roster_requested`, which each account's runner honours
at most once per 30 s. There is no periodic refresh and no freshness rule:
adoption and can-send read the stored roster, and WhatsApp's own rejection of
a send is the final check.

Groups with disappearing messages are added like any other: Macro keeps their
messages permanently, the roster keeps WhatsApp's timer
(`GroupInfo.disappearing_seconds`, shown on the detail), and Macro's sends
carry it as `contextInfo.expiration` so members' phones expire them like their
own. A community's own entry (`community_parent`) has no messages and can't be
added; its groups and announcement group (`community_jid`, named on the chat
list and detail as `community`) are ordinary groups, the announcement group
under the usual admins-only posting rule.

Adding (`POST /external-chats` with `{provider: "whatsapp", remoteId, kind}`;
the kind must match the JID) makes the chat the adder's own entity: one live
`external_chat` per (owner, provider, remote id), so two people adding the
same WhatsApp group get two Macro chats, and adding it again returns the
existing one. No team is involved. It registers `EntityType::ExternalChat`,
grants the adder Owner through `entity_access`, and records their account's
`whatsapp_chat_membership`. The name always follows WhatsApp: the subject, or
for an unnamed group the other members' names ("Ana, Ben, +2"), updated when
the owner's account sees a change. `GET /whatsapp/chats` marks each WhatsApp
chat with the caller's own external chat (`added`) or, when they have none,
one shared with them by someone else (`shared`, with its owner).

`whatsapp_chat` is each account's chat list as WhatsApp Web shows it, groups
and direct chats: name, last activity, archived and pinned, and the newest
known message (the anchor). WhatsApp's history sync right after pairing fills
it (initial, recent and full bundles; push-name bundles rename direct chats);
live messages in any chat bump activity and add new chats; push-name, archive
and pin updates change existing rows. The phone's saved contacts (address-book
names from app state) are listed as direct chats with no activity, so the owner
can start a chat with someone never written to: all of them on connect and
after each app-state sync, each contact change as it arrives; a row that didn't
change signals nothing. It never holds message content.
`GET /whatsapp/chats` merges it with the roster (the roster names groups and decides
which groups can be added), newest first, and gives a direct chat's phone
number.

Anyone else is reached by phone number: `POST /whatsapp/lookups {phoneNumber}`
(E.164; the owner's own session only, at most 20 per account per hour, since
WhatsApp bans accounts that check many numbers) records a `whatsapp_lookup`
and signals `whatsapp_lookup_requested`; the session holding the account asks
WhatsApp once (`IsOnWhatsApp`, which also stores the number's LID pairing) and
records `found`, `not_on_whatsapp` or `failed`. A found number joins the chat
list as a direct chat by phone number, so the ordinary add accepts it; the web
polls `GET /whatsapp/lookups/{id}`, then adds and opens the chat. A lookup still
pending after 60 seconds reads as `failed`. Lookups are deleted an hour later,
and with the account's consent.

Direct chats are added like groups (`external_chat.kind = 'direct'`,
`remote_id` the other person's JID, by phone number when known) and named after the
person as the chat list names them. The owner's account is the only member: it
observes the chat from adoption on (renewed on every full roster refresh), and
only the owner sends; people it is shared with read. Someone else's chat with
the same person is their own conversation, never "shared with you". WhatsApp
addresses a direct chat by LID or phone number: each message carries the
chat's other address (`InboundEvent.chat_alternate_jid`, from the message or
the LID store) and the session gate files it under whichever the chat was
added by; history is requested in the chat as the phone keys it (by LID).
An account paired before the list existed only gets groups and chats with new
messages: WhatsApp sends the full list once, at pairing.

Adding a group sets `backfill_state = 'pending'` when a message of the chat is
known to start from (the chat list's anchor, or a stored message the account
saw), else `waiting_for_message`: nothing to import from until someone posts.
A direct chat with no known message (a saved contact or looked-up number)
starts `done`: there is nothing earlier to import, and its first message
arrives live. If a chat update later brings a message from before the chat
was added (the phone had history after all), it goes back to `pending` once
and imports like any chat.
The chat's first message (live, history sync or chat-list update) makes it
`pending` and starts the import at once. The owner's account then
imports the chat's earlier messages from the phone, on demand only: it asks for
the anchor message itself when it predates adoption (a placeholder resend) and
for pages of 50 messages before the oldest imported one (history sync on
demand), until the phone has nothing older (`done`) or 500 messages / 90 days
(`partial`). An unanswered request (60 s) means `waiting_for_phone`, retried
every 5 minutes and at once on reconnect. WhatsApp's group info carries no
message id, so a quiet chat of an account paired before the chat list existed
has no other anchor. Imported messages are ingested as history (origin
`history`): no notifications, no unread, deduplicated with live messages by
source id, and only into the owner's own chats, which replaces the
adoption-time boundary for them. The cursor (`backfill_cursor`) is WhatsApp's
`{id, at, fromMe, senderJid}`.

Viewing, sharing, live updates and notifications are the generic external
chat rules ([External chats](external-chats.md)). Viewing needs no connected
WhatsApp account or remote membership; leaving WhatsApp or disconnecting keeps
established access and history; roster updates never create sharing grants.

## Inbound, timeline and notifications

The replica keeps only events for added chats, persists them before ACK and
calls `ingest_event`. Unadopted events never enter storage. Every observer converges
on `(chat, verified person, source id)` in `external_chat_message` (origin
`remote`); messages do not reference native comms storage. Sender associations use verified phone/LID
aliases: WhatsApp's from-me flag makes the sender the account's own identity,
and the session service fills the other half of a sender's pair from the
account's LID store (ingest also from the account's roster). Identities still
ambiguous are quarantined and retried. Missing reaction/revision targets
are deferred. Edits follow source revision order; deletes are permanent tombstones.
Reactions and media live in `external_chat_reaction` and `external_chat_attachment`.

Besides text and media, a message may carry structured content in
`external_chat_message.rich` (`external_chat::domain::rich::RichContent`):
polls, locations, contact cards and WhatsApp events, plus `mentions` (WhatsApp
ids the text @-mentions) and `forwarded`. Poll votes are decrypted by the
replica with the poll's message secret and kept per voter in
`external_chat_poll_vote` (latest revision wins); history pages bring them
already decrypted. System lines (`kind = 'system'`) record what happened in a
group: live `w:gp2` notifications (subject, description, disappearing timer,
members added, removed, left, joined by link, promoted, demoted; each gets a
stable synthetic source id), group icon changes, pins, call logs and the stub
messages of history pages (including group creation). They never notify and
never count as unread. The timeline resolves the ids in mentions, system lines
and votes to names (people seen in the group, then the roster, then the phone
number). View-once media is kept and shown like any media (marked
`view_once`); shapes Macro does not read stay readable placeholders. Attachments keep WhatsApp's declared width, height and length,
and whether WhatsApp shows them as a sticker, GIF or voice note.

Reads, unread counts and notifications follow the generic rules
([External chats](external-chats.md)).

## Sending

DSS records a `whatsapp_send` intent (idempotency key, request digest, chat
sequence, the request's `traceparent`) only while the sender's account is
connected, observing and allowed to post. A request repeating an intent key
returns the stored send, whatever changed since; a different payload with the
same key conflicts. The dispatch span joins the recording request's trace. The replica claims pending sends in chat order, calls
`begin_dispatch` with the WhatsApp message id it will use (all facts are
re-checked; this is the point of no return), submits, then calls
`record_send_outcome`. An acceptance writes the group message with the
sender's identity; the later echo converges on it. A replica that dies after
`begin_dispatch` leaves the send `unknown`; it is never sent again, and a later
echo settles it. Unattempted intents expire after ten minutes. Edits and
deletes are limited to the sender's own messages for ten minutes.

## Rollout and incidents

The web flag `enable-whatsapp-linked` is the only rollout gate; DSS always
serves `/external-chats` and `/whatsapp`. To stop all WhatsApp traffic (receiving and sending),
scale the session service to zero tasks: accounts stay `connected`, history and
access are kept, and sends recorded meanwhile expire unsent after ten minutes.
Replicas pick every account up again when scaled back. Prod runs two replicas
and dev one (`infra/stacks/whatsapp-session-service/service.ts`); with two, a
deploy hands every lease to a running replica. A deploy restores the task
count. Prod deploys with each published release.

## Media

Inbound attachments are reserved per ordinal at ingest, with the download
locator sealed by the session service under the observing account's key. That
account's replica claims the download (`claim_media_imports`), checks the
SHA-256 and hands over the bytes (`complete_media_import`), which wait in
`external_chat_media_blob` until DSS (signal `whatsapp_media_ready`) stores
them as a static file ([External chats](external-chats.md#attachments)).
Ready bytes are never rewritten. Failures retry with backoff and then expose
an `unavailable` attachment state; message bodies remain plain WhatsApp text.

Outbound: the attachments route stages one file per send in the blob table;
`ReplyContent::Media` names it, the replica fetches it with `outbound_media`,
and on acceptance it is imported as the message's static file, owned by the
sender.
Staging reads the file's pixel size and length from its headers
(`domain::shape`: image headers, MP4 `tkhd`/`mvhd`, Ogg/Opus granule); the
sent WhatsApp message and the stored attachment carry them like received ones.
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
user, shared across chats and DSS replicas through its existing Redis rate
limiter. The domain consumes the budget before evaluating a new send (a replayed
intent key does not); requests that later fail still count. Exhaustion returns `429` with code `rate_limited` and
`Retry-After: 1`; an unavailable counter fails closed with `503`. This does not
retry a send or change its idempotency key or unknown-outcome reconciliation.

Only the person who owns a connection sends from it, using their session or their
own API credential, including a verified Macro API JWT with signed agent attribution.
The domain resolves the sending account from the authenticated person, never from
the chat owner or request input. Media uploads follow the same owner policy.
Bot, harness and internal principals never send, including bots acting for a user.
Pairing reads (including QR codes and passkey challenges) and account/access
controls require the person's bearer session; API credentials cannot perform them.

## Follow-ups

- Participant receipts are stored but not shown.

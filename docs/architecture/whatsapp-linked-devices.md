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

| Signal | Payload | Sent by → read by | Meaning |
| --- | --- | --- | --- |
| `whatsapp_pairing_requested` | pairing id | DSS → session | start, update or stop (cancelled) pairing |
| `whatsapp_send_requested` | account id | DSS → session | claim pending sends |
| `whatsapp_groups_requested` | account id | DSS → session | refresh the account's group metadata |
| `whatsapp_account_changed` | account id | DSS → session | consent or adopted groups changed; re-read |
| `whatsapp_account_released` | account id | session ↔ session | lease handed over |
| `whatsapp_group_effects` | message id | session → DSS | a group notification revision is ready |

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

The replica keeps `whatsapp_group_roster` (the account's view of its groups)
fresh with `update_groups`. Adoption requires metadata observed within two
minutes; stale facts request a refresh and return `refreshing`. Adoption
creates `whatsapp_group`, registers it as `EntityType::WhatsAppGroup`, grants the
adopter Owner through `entity_access`, and records their remote membership facts.
The caller supplies a name and optionally their team; the server selects their
team when omitted. A team/group pair has one active adoption. Existing adoption
requires view access and never grants a new viewer access implicitly.

Viewing uses ordinary entity sharing: direct people grants and access requests
at `/entities/whatsapp_group/{id}/...`, canonical explicit team grants, and link
sharing. It requires no connected WhatsApp account or remote group membership.
The group detail includes `share_permission` and `access_level`; its `/permissions`
GET/PATCH pair drives the standard Share dialog. Only the actual owner changes
team/link policy or detaches the group. Leaving WhatsApp or disconnecting keeps
established access and history. Roster updates never create sharing grants.

## Inbound, timeline and notifications

The replica keeps only events for adopted groups, persists them before ACK and
calls `ingest_event`. Unadopted events never enter storage. Every observer converges
on `(group, verified person, source id)` in `whatsapp_group_message`; messages do
not reference native comms storage. Sender associations use verified phone/LID
aliases; ambiguous identities are quarantined. Missing reaction/revision targets
are deferred. Edits follow source revision order; deletes are permanent tombstones.
Reactions and media live in `whatsapp_group_reaction` and `whatsapp_group_attachment`.

`GET /meta/linked/whatsapp-groups` lists shared groups with viewer-specific unread
counts and sending eligibility. Detail and messages live under
`/meta/linked/whatsapp-groups/{group_id}`. Messages page newest-first using stable
`(sent_at,id)` keysets with an opaque message-id `before` cursor. The `/read`
endpoint advances `whatsapp_group_read_state` monotonically; history and the
viewer's own messages do not increase unread counts.

DSS drains a durable notification outbox through the generic notification ingress.
`whatsapp_group_message` notifications target directly shared users, team members,
and known link viewers who have read the group, except the verified sender. Link
viewers must still have access when recipients are resolved; unknown link visitors cannot be
enumerated. Notifications use the message id for idempotency and are suppressed
for history, replays, edits and reactions. They link to the standalone group entity.
GraphQL notification targets use the canonical entity enum while groups remain outside Soup.

## Sending

DSS records a `whatsapp_send` intent (idempotency key, request digest, group
sequence) only while the sender's account is connected, observing and allowed
to post. The replica claims pending sends in group order, calls
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
limiter. The domain consumes the budget before evaluating a send; requests that
later fail still count. Exhaustion returns `429` with code `rate_limited` and
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

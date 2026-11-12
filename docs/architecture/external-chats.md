# External chats

A chat from another messaging service that a person adds to Macro becomes an
`external_chat` entity: theirs, shared like any other entity, readable without
an account at the provider. DSS serves every provider through one service;
how WhatsApp accounts are linked and their messages reach Macro is in
[WhatsApp linked devices](whatsapp-linked-devices.md).

## Model

| Concept | Where |
| --- | --- |
| Entity | `EntityType::ExternalChat` (wire `external_chat`, GraphQL `EXTERNAL_CHAT`) |
| Provider | `model_entity::ExternalChatProvider` (`whatsapp`); `label()` names it for people |
| Kind | `model_entity::ExternalChatKind` (`group`, `direct`) |
| Chat | `external_chat`: `provider`, `remote_id` (the provider's id; WhatsApp: a JID), `kind`, name, owner, `state`, history import (`backfill_*`) |
| People | `external_chat_person` (the provider's display name, verified Macro user); the provider names them for reads (`ChatProvider::people`) |
| Messages | `external_chat_message`: one row per `(chat, person, source id)`; `origin` is `remote`, `macro` or `history`; `kind` `message` or `system`; structured `rich` content and `mentions` (provider ids); a thread reply names its root in `thread_root` (`thread_broadcast` when also sent to the chat) |
| Reactions | `external_chat_reaction`, keyed by message, person and emoji: a provider may let a person hold several (WhatsApp keeps one, replacing it) |
| Poll votes | `external_chat_poll_vote` (per person, latest revision wins) |
| Attachments | `external_chat_attachment` (one per source ordinal, a static file once `ready`); staged bytes in `external_chat_media_blob`; released files in `external_chat_file_deletion` |
| Read state | `external_chat_read_state` (monotone, per viewer) and `external_chat_thread_read_state` (per viewer and thread) |

The provider owns everything about its accounts and transport (for WhatsApp:
`whatsapp_*` tables, including the per-account membership that decides who
may send). `external_chat_attachment` carries the provider's download state:
`account_id` (an account in the chat's provider's own table, no foreign key),
an opaque sealed `locator`, and the claim columns; `sha256` stays empty until
a download where the provider learns it only then.

The reaction key gained the emoji (migrations `20261111230606`/`07`). Between
those migrations and the deploy of the new session service, an old binary's
reaction upsert (`ON CONFLICT (message_id, person_id)`) fails; the queued
inbound event is retried with backoff (up to 20 attempts, hours apart at the
end) and lands once the new binary runs.

## Access

Viewing uses ordinary entity sharing: `entity_access` grants (people, teams,
and channels through mentions), link and team sharing on the chat's
`SharePermission`, and access requests at `/entities/external_chat/{id}/...`.
The database holds the one view rule, `external_chat_access_level(chat_id,
sources)`; `external_chat_can_view` and `entity_access`
(`ExternalChatAccessLevelExtractor`, path parameter `chat_id`) both call it.
Only the person who added the chat owns it: they change team and link
sharing and remove it. Mentioning a chat in a channel message shares it with
the channel's current members (View) through the reference-sharing path
(`ReferencedShareItemType::ExternalChat`). Viewing never needs an account at
the provider. Deleting a chat (`cleanup_external_chat`) deletes its grants,
entity record and sharing settings.

## API

DSS serves the generic API at `/external-chats` (operation ids
`external_chat*`) and each provider's account API beside it (`/whatsapp`).

| Route | Purpose |
| --- | --- |
| `GET /external-chats` | chats the caller can view, with unread counts and send eligibility |
| `POST /external-chats` | add `{provider, remoteId, kind}` from the caller's own provider account |
| `GET`, `DELETE /external-chats/{chat_id}` | detail (`members`, sharing, limits); stop syncing (owner) |
| `GET /external-chats/{chat_id}/messages[/{message_id}]` | newest-first pages (`before` cursor); `thread=<root>` pages that thread's replies instead |
| `POST /external-chats/{chat_id}/messages/attachments` | attachment states by message id |
| `POST /external-chats/{chat_id}/read` | advance the viewer's read position (a thread reply advances its thread's) |
| `GET`, `PATCH /external-chats/{chat_id}/permissions` | the Share dialog |
| `GET`, `POST /external-chats/{chat_id}/sends` | open sends; send from the caller's own account |
| `POST /external-chats/{chat_id}/attachments` | stage one file for a send |
| `POST /external-chats/{chat_id}/delivery` | send progress by intent or message id |

Summaries and details carry `provider` and `kind`. Threads: the timeline
leaves out thread replies not also sent to the chat, and they don't count as
unread there; a root message carries `thread` (`replyCount`, `lastReplyAt`,
`unread` for the viewer); a send replies in a thread with `thread: <root>`
where the provider's `limits.threads` allows it. When the viewer can't
send, `sendReason` says why: `no_account`, `disconnected`, `not_added` (their
account hasn't added this chat), `not_allowed` (not in it, or may not post
now) or `unavailable` (removed). Sends, uploads and adds take the person's
session or their own API credential; bots, harnesses and internal callers
never send.

## Live updates

Writes that change what a page shows signal `external_chat_changed` in the
writing transaction: `{scope: "chats", provider, account_id}` for an
account's own chat list (DSS asks that provider who owns the account), `{scope: "chat", chat_id}` for a chat. DSS coalesces a burst and pushes
a bare connection-gateway message `external_chat_changed` with
`{scope: "chats"}` to the account's owner or `{scope: "chat", chatId}` to
everyone who can view the chat; the page re-fetches.

## Notifications

A new live message (origin `remote` or `macro`, not a system line) signals
`external_chat_effects`; DSS drains the outbox and sends an
`external_chat_message` notification (`{provider, chatName, messageId}`,
body "New WhatsApp message", collapse key `external_chat:<id>`) to directly
shared users, team and channel members, and link viewers who have read the
chat, except the verified sender. History, system lines, replays, edits,
reactions and poll votes never notify. The message id is the notification id.

A provider whose account stops syncing (the session ended, an administrator
blocks it, or the stored credentials can't be read) sends its owner one
`external_chat_account_ended` notification per consent generation
(`{provider, accountId, accountName, reason}`, title "<Provider>
disconnected", entity the owner's user, collapse key
`external_chat_account:<account id>`).

Released clients still name the pre-rename `WHATSAPP_GROUP` entity type and
`GraphqlWhatsappGroupMessageMetadata` in their GraphQL documents, so the
schema keeps both as inert stubs until 2026-11-30: the enum value is rejected
as input and the uninhabited type is never returned.

## Attachments

Bytes arrive in `external_chat_media_blob` (a provider download, or a file
staged for a send) and DSS stores them as a static file owned by the chat's
owner or the uploader, like Chat's media: anyone holding the file id can read
it, and unsharing doesn't take back an id already seen. A file no attachment
references any more is queued in `external_chat_file_deletion` by a trigger
and deleted from the static file service by DSS's drain.

## Code

`crates/external_chat` is the provider-neutral domain: timeline and read
state, sharing, sends, uploads, attachment import, notification effects, the
`external_chat_changed`/`external_chat_effects` signals, the
`/external-chats` router and the Postgres adapters for the `external_chat*`
tables. It reaches a provider only through its `ChatProvider` port
(accounts and their owners, who can send, members and names, adding and
detaching, the send outbox, and `read_advanced`, which hears the owner's read
positions; a provider that mirrors them implements it, the default does
nothing). `ExternalChatService` holds a `ChatProviders` registry, one field
per `ExternalChatProvider` and an exhaustive `get`, and sends each call to
the provider of the chat or of the request; `list` asks each provider about
its own chats. A new provider is a variant, a registry field and its
`ChatProvider` impl; tests leave unused slots to `UnconfiguredProvider`
(feature `test-support`), which panics. `crates/whatsapp_linked` implements the port
(`WhatsAppProvider`) and keeps everything WhatsApp: pairing, the account's
chat list (with saved contacts) and phone-number lookups, rosters, ingest,
dispatch and the `/whatsapp` router; its ingest
writes the generic tables with `external_chat::outbound::pg` helpers.
Dependencies point from `whatsapp_linked` to `external_chat`, never back.
DSS composes the registry in `src/external_chat.rs`. The web app's
conversation is `features/external-chat`; the External tab
(`features/external-view`) lists the chats of every provider whose flag is on
(`provider-flags.ts`: WhatsApp's is `enable-whatsapp-linked`) and shows the
selected provider's page from `provider-pages.tsx`.

## Follow-ups

- Soup and search registration; External, links and notifications are the
  entry points.

# whatsapp_linked

## What it is

The WhatsApp provider of external chats (`crates/external_chat`): personal
WhatsApp accounts linked as devices, owner-bound pairing, the account's chat
list and rosters, adding an existing group or direct chat as the adder's
own `ExternalChat` entity (one per owner, provider and remote chat, named
after WhatsApp), ingesting chat traffic, and dispatching deliberate sends
from each person's own account. `WhatsAppProvider` implements
`external_chat`'s `ChatProvider`; `external_chat` owns the timeline, read
state, sharing, send validation, uploads, notification effects and the
`/external-chats` routes. `ChatRef.kind` / `external_chat.kind` says group or
direct (only the owner sends in a direct chat). DSS serves `/whatsapp/*`; the
WhatsApp session service calls `domain::session::SessionService` in-process.
They share no HTTP: only MacroDB rows and `NOTIFY` (`external_chat`'s
`outbound::pg` notify helpers).

## Start here

- `src/domain/service.rs`: DSS use cases for the account, pairing and chat
  list. `src/domain/provider.rs`: `ChatProvider` for WhatsApp (adoption
  validation, who can send, members, names, the send outbox).
- `src/domain/session.rs` + `src/domain/events.rs`: the session-service API and
  its event types (no whatsmeow types).
- `src/outbound/pg/ingest.rs`: canonical identity `(binding, person, source id)`,
  quarantine, deferral and the standalone message write. Senders are resolved
  first (`resolve_sender_in`): WhatsApp's from-me flag means the account's own
  identity; a LID-only sender takes its phone number from the account's roster
  pair. Only what is still LID-only is quarantined.
- Structured content (`external_chat::domain::rich::RichContent`: poll, poll
  vote, location, contact cards, event, system line) is stored in
  `external_chat_message.rich`; `kind = 'system'` rows never notify or count
  as unread. `GroupRepository::people` names the WhatsApp ids in mentions,
  system lines and votes for `external_chat`'s timeline view. Poll votes are
  stored per voter in `external_chat_poll_vote` through the reaction path of
  `reserve_in`. A re-ingested message fills in `rich`/`mentions`/`forwarded`
  an earlier copy lacked (re-importing history upgrades old placeholders).
- `src/outbound/pg/chats.rs`: the account's chat list (`whatsapp_chat`,
  `GET /whatsapp/chats` via `WhatsAppService::chats`) and importing earlier messages of
  added chats (`backfill_*` columns on `external_chat`; limits
  `BACKFILL_MESSAGE_LIMIT` / `BACKFILL_MAX_AGE_DAYS` in `models.rs`). The
  anchor is the chat's `whatsapp_chat.anchor`, else the newest stored message
  the account saw; without one a group is `waiting_for_message` until a chat
  update brings one, and a direct chat (a saved contact, a looked-up number)
  is added `done`, reopened to `pending` only by an anchor older than its
  adoption while nothing was imported. Saved contacts are chat-list rows with no activity. History
  messages skip the adoption-time boundary but only reach the account owner's
  own groups (`observed_bindings_in`).
- `src/outbound/pg/lookups.rs`: phone-number lookups (`whatsapp_lookup`,
  `POST`/`GET /whatsapp/lookups`): DSS records one (E.164 `PhoneNumber` in
  `domain/jid.rs`, human sessions only, `LOOKUP_LIMIT` per
  `LOOKUP_WINDOW_MINUTES`, a pending one of the same number is reused) and
  signals `whatsapp_lookup_requested`; the session records the answer, and a
  found number joins the chat list so `adopt` accepts it unchanged. Pending
  past `LOOKUP_EXPIRY_SECONDS` reads `failed`; rows go with the account's
  consent and after the window.
- `src/outbound/pg/sends.rs`: enqueue, claim, dispatch fence, outcome. A
  repeated intent key returns the stored send before any other check.
- `src/signals.rs`: the DSS ↔ session-service `NOTIFY` channels; payloads,
  trace context and the channels DSS listens on are `external_chat::signals`.
  Writes send them inside the writing transaction. Every write a page shows
  calls `notify_change` (`external_chat_changed`); DSS pushes it to viewers.
  Roster writes signal only real changes (`groups.rs` `same_facts`).
- Migrations:
  `crates/macro_db_client/migrations/20261027061310_whatsapp_linked.sql` (the
  first schema, with its entity type validation), then
  `20261027194950_whatsapp_attachments_as_static_files.sql` (attachments keep a
  static `file_id`), then `*_external_chat.sql` (the generic `external_chat*`
  tables, the view rule `external_chat_access_level` that entity_access also
  calls, and `whatsapp_roster`/`whatsapp_chat_membership`; released files
  queue in `external_chat_file_deletion`) and its entity type validation, then
  `*_whatsapp_lookup.sql` (phone-number lookups).
  Deleting a user cascades to their account,
  chats (with their grants, entity record and sharing settings) and sends;
  aliases outlive the account that saw them.
## Boundaries

- Depends on: `external_chat` (models, ports, generic table helpers),
  `entity_access_db_utils` (the adopter's owner grant),
  `entity_registry_db_utils`, and `share_permission_db_utils`.
- Used by: DSS (`src/external_chat.rs` composition), the session service.

## Checks

- `cargo test -p whatsapp_linked --all-features` (`SQLX_OFFLINE` unset); its
  Postgres tests also cover `external_chat`'s reads and writes end to end.
- Check `--no-default-features --features ports` and `inbound` independently; domain dependencies must be enabled by `ports`, not only by the Postgres adapter.

## Gotchas

- Pairing reads and account controls require a human session (the
  authority rules, send budget and `SendRateLimiter` are `external_chat`'s).
- Lock accounts before groups, then child rows; lock every group in a batch in UUID order. Pairing expiry locks affected accounts before pairing rows. Media completion takes the group lock before attachment/message writes.
- Every session-service write takes the account row lock at the caller's
  `lease_epoch`; `ExternalChatError::Fenced` means stop the account now.
- `dispatch_started_at` is written before submission. A dispatched send without
  an outcome becomes `unknown` on takeover and is never resent; a later echo
  with its `allocated_source_id` settles it.
- View access is independent of WhatsApp membership (see
  `crates/external_chat`); only the adopter receives an owner grant. Queries
  look chats up by `(provider, remote_id)`.
- Store messages/reactions/attachments/poll votes in `external_chat_message`,
  `external_chat_reaction`, `external_chat_attachment` and
  `external_chat_poll_vote`; never native comms tables.
- Attachment bytes cross Postgres (`external_chat_media_blob`, ≤ 32 MiB) because the
  session service has no file storage; `external_chat`'s `MediaService` in DSS
  turns them into static files. `events::Media::locator` is sealed by the
  session service; never read it. `src/outbound/pg/media.rs`: download
  claims. Not implemented: participant-receipt UI.

## Related

- Docs: `docs/architecture/external-chats.md`, `docs/architecture/whatsapp-linked-devices.md` · Rules: `.agents/rules/observability.md`

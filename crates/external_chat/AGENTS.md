# external_chat

## What it is

External chats: a chat from another messaging service (WhatsApp is the one
provider) added to Macro as an independently shared `ExternalChat` entity.
This crate is the provider-neutral part: list and detail, timeline, read
state, sharing, deliberate sends and uploads, attachment import into static
files, notification effects and the `/external-chats` routes, over the
`external_chat*` tables. A provider (`crates/whatsapp_linked`) implements the
`ChatProvider` port; DSS composes `ExternalChatService<WhatsAppProvider>`.

## Start here

- `src/domain/ports.rs`: `ChatProvider` (accounts, who can send, members,
  names, communities, adopt/detach, the provider's send outbox) and the
  repository, publisher, file store and rate limiter ports.
- `src/domain/service.rs` + `service/timeline.rs`: the use cases. The
  `ReplyBlock` decision (`reply_block`) combines `SendAuthority`, the
  provider account and its `SendingFacts`.
- `src/domain/timeline.rs` + `timeline/view.rs`: DTOs and how stored rich
  content, mentions and votes become names and tallies (`People` comes from
  the provider). `src/domain/rich.rs`: stored `RichContent`.
- `src/domain/effects.rs`, `media.rs`: notification outbox and attachment
  import drained by DSS. `src/signals.rs`: channels DSS listens on.
- `src/outbound/pg.rs`: the adapter, plus public transaction helpers
  (`notify`, `notify_change`, `lock_chat_in`, `fail_attachment_in`, ...) a
  provider's adapter uses when it writes the generic tables.

## Boundaries

- Depends on: `entity_access` (receipts), `entity_access_db_utils`,
  `share_permission_db_utils`.
- Used by: `whatsapp_linked` (implements the port), DSS, the session service
  (signals, models) and `whatsapp_e2e`. Never depends on a provider.

## Checks

- `cargo test -p external_chat --all-features`; the end-to-end Postgres tests
  of these reads need the WhatsApp ingest and live in `whatsapp_linked`
  (`cargo test -p whatsapp_linked --all-features`, `SQLX_OFFLINE` unset).
- Check `--no-default-features --features ports` and `inbound` independently.

## Gotchas

- No provider tables (`whatsapp_*`) in this crate's SQL: anything a provider
  stores is read through `ChatProvider`.
- HTTP error JSON, codes and some messages still name WhatsApp; they are API
  and change only with the web app.
- View access is `external_chat_access_level` (see
  `docs/architecture/external-chats.md`); bot view receipts read but never
  borrow a person's account, sends or unread cursor (`view_scope`).

## Related

- Docs: `docs/architecture/external-chats.md`,
  `docs/architecture/whatsapp-linked-devices.md` · Rules:
  `.agents/rules/observability.md`

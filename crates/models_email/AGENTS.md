# models_email

## What it is

Part of the Email feature. Wire models for email and Gmail sync:
thread/message API types, DB row types, and Gmail API response shapes.

## Start here

- `src/email/mod.rs` → `api`, `db`, `service`: the three-layer email model
  split (API-facing, DB row, service-layer), mirroring `models_properties`.
- `src/gmail.rs` + `src/gmail/`: Gmail API response types — `contacts.rs`,
  `filters.rs`, `history.rs`, `inbox_sync.rs`, `labels.rs`, `gmail_ops.rs`,
  `operations.rs`.

## Scope

- `UserProvider` includes Gmail, Outlook and IMAP. API spelling is uppercase;
  service variants are explicit. Use `uses_mailbox_framework` to distinguish
  durable organization/draft work from Gmail's queue operations.

- Owns: email/Gmail wire and DB-row models shared across email services.
- `service::message::SendRejectionReason` is the shared closed non-submission
  fact used by provider errors and durable operation status. Keep it independent
  of provider adapters so the email `ports` feature can expose it alone.
- Not here: calendar sync (moved out, see `#6826`) → `calendar_events`;
  actual IMAP/SMTP calls → `imap_engine`; Gmail API calls → `gmail_client`.

## Boundaries

- Depends on: `email_utils`, `macro_user_id`, `models_pagination`.
- Used by: `ai_tools`, `calendar_service`, `email_api_client`, `email_db_client`,
  `email_refresh_handler`, `email_scheduled_handler`, `email_service(_client)`,
  `gmail_client`, `search_processing_service`, `search_service`, `sqs_client`,
  `teams`.

## Checks

- `cargo test -p models_email` (`SQLX_OFFLINE` unset).

Parsed message responses expose the draft generation captured in the same SQL snapshot as their content.

Preview wire names include `spam` and `trash`; provider folder semantics belong to
the email domain and use normalized mailbox facts, not Gmail-only label names.

Historical CRM messages use `PopulateCrmPolicy` with mandatory team, mailbox,
work ID, consent incarnation and policy version. Missing `live_mail` on a
`PopulateCrmContact` payload means legacy history; new per-message hints set it
true and reconcile current stored eligibility. Preserve this distinction during
rolling upgrades; decoding old payloads must never attach a current generation.

## Related

- Rules: `.agents/rules/rust/architecture.md`

- Scheduled-message models retain optional agent correlation for delayed delivery; older rows decode without attribution.

- `sign_in_email` recognises Macro's own sign-in emails by sender: the addresses FusionAuth and the auth service send sign-in mail from, which send nothing else. Its tests read the FusionAuth stack's per-environment config and the local kickstart, so a changed sender fails them; update `SIGN_IN_SENDERS` with it.

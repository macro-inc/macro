//! Signals between DSS and the session service over Postgres `NOTIFY`. Each
//! payload is an [`external_chat::signals::Signal`] with the sender's
//! `traceparent`; the channels DSS listens on are in `external_chat::signals`.

/// `<pairing_id>`: start, update or stop pairing.
pub const PAIRING_REQUESTED: &str = "whatsapp_pairing_requested";
/// `<account_id>`: claim pending sends.
pub const SEND_REQUESTED: &str = "whatsapp_send_requested";
/// `<account_id>`: answer pending phone-number lookups.
pub const LOOKUP_REQUESTED: &str = "whatsapp_lookup_requested";
/// `<account_id>`: the owner started importing earlier messages; ask the
/// phone for the chats that are `pending`.
pub const HISTORY_REQUESTED: &str = "whatsapp_history_requested";
/// `<account_id>`: re-read the account's groups.
pub const GROUPS_REQUESTED: &str = "whatsapp_roster_requested";
/// `<account_id>`: consent or adopted groups changed; re-read the account.
pub const ACCOUNT_CHANGED: &str = "whatsapp_account_changed";
/// `<account_id>`: a replica released the account (session service only).
pub const ACCOUNT_RELEASED: &str = "whatsapp_account_released";

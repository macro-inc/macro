//! Signals between DSS and the session service over Postgres `NOTIFY`. Each
//! payload is an [`external_chat::signals::Signal`] with the sender's
//! `traceparent`; the channels DSS listens on are in `external_chat::signals`.

/// `<attempt_id>`: a sign-in attempt has input to process.
pub const LOGIN_REQUESTED: &str = "slack_login_requested";
/// `<account_id>`: new account, consent or added chats changed; re-read.
pub const ACCOUNT_CHANGED: &str = "slack_account_changed";
/// `<account_id>`: refresh the Slack Connect catalogue.
pub const CATALOGUE_REQUESTED: &str = "slack_catalogue_requested";
/// `<account_id>`: import earlier messages of the account's chats that are
/// `pending`.
pub const HISTORY_REQUESTED: &str = "slack_history_requested";
/// `<account_id>`: claim pending sends.
pub const SEND_REQUESTED: &str = "slack_send_requested";
/// `<account_id>`: send pending read marks.
pub const READ_REQUESTED: &str = "slack_read_requested";
/// `<account_id>`: a replica released the account (session service only).
pub const ACCOUNT_RELEASED: &str = "slack_account_released";
/// `<account_id>`: Slack ended the account's session; DSS tells its owner
/// (session service → DSS).
pub const ACCOUNT_ENDED: &str = "slack_account_ended";

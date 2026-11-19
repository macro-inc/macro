//! Closed capability facts from the last successful TLS-authenticated verification.
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Negotiated capability flags. Provider banners and EHLO arguments are never retained.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerFeatures {
    /// When both authenticated endpoints last answered the capability check.
    pub verified_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Incoming server advertises IDLE.
    pub idle: bool,
    /// Incoming server advertises CONDSTORE.
    pub condstore: bool,
    /// Incoming server supports per-UID copy and expunge receipts.
    pub uid_plus: bool,
    /// Incoming server supports the MOVE command.
    pub move_messages: bool,
    /// Incoming server supplies RFC 8474 object identifiers.
    pub object_id: bool,
    /// Incoming server advertises Gmail's IMAP extension.
    pub gmail_extensions: bool,
    /// Submission server accepts SMTPUTF8 envelopes.
    pub smtp_utf8: bool,
    /// Submission server accepts 8BITMIME payloads.
    pub eight_bit_mime: bool,
    /// Server-advertised positive SIZE limit in bytes.
    pub send_limit_bytes: Option<u64>,
}

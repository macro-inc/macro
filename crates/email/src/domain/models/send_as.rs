//! Domain models for Gmail send-as aliases.
//!
//! A send-as alias allows a user to send email from an alternative address
//! (e.g. support@company.com) using their primary Gmail inbox.

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// A persisted send-as alias for an email inbox.
///
/// Each inbox (email link) can have multiple send-as aliases configured.
/// The inbox's primary address is always available and does not need to be
/// stored as an alias.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendAsAlias {
    /// Unique identifier for this alias record.
    pub id: Uuid,
    /// The email link (inbox) this alias belongs to.
    pub link_id: Uuid,
    /// The email address this alias sends as.
    pub send_as_email: String,
    /// Display name shown in the From field.
    pub display_name: Option<String>,
    /// Reply-to address if different from send_as_email.
    pub reply_to_address: Option<String>,
    /// Gmail-assigned HTML signature for this alias.
    pub signature_html: Option<String>,
    /// Whether this is the default send-as for the inbox.
    pub is_default: bool,
    /// Whether this alias has been verified by Gmail.
    pub is_verified: bool,
    /// Whether this is the primary address for the Gmail account.
    pub is_primary: bool,
    /// When this record was created.
    pub created_at: DateTime<Utc>,
    /// When this record was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A user-facing send-as alias option for the compose UI.
///
/// Contains only the fields needed for the sender picker dropdown.
#[derive(Debug, Clone)]
pub struct SendAsOption {
    /// The email address to send as.
    pub email: String,
    /// Display name for the From header.
    pub display_name: Option<String>,
    /// Whether this is the default send-as for the inbox.
    pub is_default: bool,
    /// Whether this is the primary inbox address.
    pub is_primary: bool,
}

impl From<&SendAsAlias> for SendAsOption {
    fn from(alias: &SendAsAlias) -> Self {
        Self {
            email: alias.send_as_email.clone(),
            display_name: alias.display_name.clone(),
            is_default: alias.is_default,
            is_primary: alias.is_primary,
        }
    }
}

/// Input for creating or updating a send-as alias from provider sync.
#[derive(Debug, Clone)]
pub struct SyncSendAsInput {
    /// The email address this alias sends as.
    pub send_as_email: String,
    /// Display name shown in the From field.
    pub display_name: Option<String>,
    /// Reply-to address if different from send_as_email.
    pub reply_to_address: Option<String>,
    /// Provider-assigned HTML signature for this alias.
    pub signature_html: Option<String>,
    /// Whether this is the default send-as for the inbox.
    pub is_default: bool,
    /// Whether this alias has been verified by the provider.
    pub is_verified: bool,
    /// Whether this is the primary address for the provider account.
    pub is_primary: bool,
}

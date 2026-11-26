use chrono::{DateTime, Utc};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// `Debug` leaves out the account's address and the owner's user id (which
/// embeds an address), so a link logged or recorded on a span carries only
/// opaque ids.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct Link {
    pub id: Uuid,
    #[schema(value_type = String)]
    pub macro_id: MacroUserIdStr<'static>,
    pub fusionauth_user_id: String,
    #[schema(value_type = String)]
    pub email_address: EmailStr<'static>,
    pub provider: UserProvider,
    pub is_sync_active: bool,
    pub is_primary: bool,
    /// Set when the link's Google grant stops yielding a token (revoked or
    /// missing); cleared on the next successful token fetch.
    pub needs_reauth: bool,
    /// When the most recent token failure was observed, if any.
    pub last_sync_error_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl std::fmt::Debug for Link {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Link")
            .field("id", &self.id)
            .field("provider", &self.provider)
            .field("is_sync_active", &self.is_sync_active)
            .field("needs_reauth", &self.needs_reauth)
            .finish_non_exhaustive()
    }
}

impl Link {
    /// Client-side mirror of the `email_links.is_primary` generated column,
    /// for constructing a [`Link`] that hasn't been persisted yet.
    pub fn derive_is_primary(macro_id: &MacroUserIdStr<'_>, email_address: &EmailStr<'_>) -> bool {
        email_address
            .0
            .as_ref()
            .eq_ignore_ascii_case(macro_id.email_str())
    }
}

/// User rollout shared by the chooser and IMAP account enrollment.
pub const IMAP_CONNECTIONS_FLAG: &str = "enable-imap-connections";

#[derive(Debug, Clone, Copy, ToSchema, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserProvider {
    Gmail,
    /// Microsoft Outlook and Microsoft 365.
    Outlook,
    /// An inbox connected through IMAP and SMTP.
    Imap,
}

impl UserProvider {
    /// Whether this provider uses durable folder streams, drafts and commands.
    pub fn uses_mailbox_framework(self) -> bool {
        match self {
            Self::Gmail => false,
            Self::Outlook | Self::Imap => true,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            UserProvider::Gmail => "GMAIL",
            UserProvider::Outlook => "OUTLOOK",
            UserProvider::Imap => "IMAP",
        }
    }
}

/// Sanitized mailbox health independent of provider authentication.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MailboxIssue {
    /// This snapshot exceeds the engine's bounded sync capacity.
    SnapshotTooLarge,
    /// Saved mailbox credentials must be replaced by an owner reconnect.
    CredentialsUnreadable,
    /// An issue introduced by a newer server; retain generic guidance.
    #[serde(other)]
    Unknown,
}

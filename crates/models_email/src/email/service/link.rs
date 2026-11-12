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
    /// Whether a newly constructed link is the account's first-party mailbox.
    /// External links can become primary only through an explicit promotion.
    pub fn derive_is_primary(provider: UserProvider) -> bool {
        provider == UserProvider::Rox
    }
}

#[derive(Debug, Clone, Copy, ToSchema, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserProvider {
    Gmail,
    /// Microsoft Outlook and Microsoft 365.
    Outlook,
    /// The account's first-party Rox mailbox.
    Rox,
}

impl UserProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserProvider::Gmail => "GMAIL",
            UserProvider::Outlook => "OUTLOOK",
            UserProvider::Rox => "ROX",
        }
    }
}

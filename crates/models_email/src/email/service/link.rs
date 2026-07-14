use chrono::{DateTime, Utc};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, Copy, ToSchema, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserProvider {
    Gmail,
}

impl UserProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserProvider::Gmail => "GMAIL",
        }
    }
}

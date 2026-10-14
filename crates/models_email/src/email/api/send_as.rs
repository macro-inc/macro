//! Send-as (alias) API models.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A send-as alias from Gmail settings, representing an email address the user
/// can send mail as. This includes the primary address as well as any configured
/// aliases.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SendAsAlias {
    /// The email address that appears in the "From:" header for mail sent using
    /// this alias.
    pub send_as_email: String,
    /// A name that appears as the sender in the "From:" header for mail sent
    /// using this alias.
    pub display_name: Option<String>,
    /// Whether this address is the primary address used to login to Gmail.
    pub is_primary: bool,
    /// Whether this address is the default "from" address for composing new
    /// messages (not replies).
    pub is_default: bool,
}

impl From<crate::gmail::SendAsAlias> for SendAsAlias {
    fn from(gmail_alias: crate::gmail::SendAsAlias) -> Self {
        Self {
            send_as_email: gmail_alias.send_as_email,
            display_name: gmail_alias.display_name,
            is_primary: gmail_alias.is_primary.unwrap_or(false),
            is_default: gmail_alias.is_default.unwrap_or(false),
        }
    }
}

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Settings {
    pub signature_on_replies_forwards: Option<bool>,
    /// The user's email signature content (HTML). On a patch, omit or send
    /// `null` to leave unchanged (both deserialize to `None`); pass an empty
    /// string to clear it. The column cannot be set to SQL NULL via patch.
    pub signature: Option<String>,
}

impl From<crate::email::service::settings::Settings> for Settings {
    fn from(service_settings: crate::email::service::settings::Settings) -> Self {
        Settings {
            signature_on_replies_forwards: Some(service_settings.signature_on_replies_forwards),
            signature: service_settings.signature,
        }
    }
}

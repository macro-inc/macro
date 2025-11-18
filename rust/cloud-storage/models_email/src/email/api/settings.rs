use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Settings {
    pub signature_on_replies_forwards: Option<bool>,
}

impl From<crate::email::service::settings::Settings> for Settings {
    fn from(service_settings: crate::email::service::settings::Settings) -> Self {
        Settings {
            signature_on_replies_forwards: Some(service_settings.signature_on_replies_forwards),
        }
    }
}

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Settings {
    pub link_id: Uuid,
    pub signature_on_replies_forwards: bool,
}

impl From<crate::email::service::settings::Settings> for Settings {
    fn from(service_settings: crate::email::service::settings::Settings) -> Self {
        Settings {
            link_id: service_settings.link_id,
            signature_on_replies_forwards: service_settings.signature_on_replies_forwards,
        }
    }
}

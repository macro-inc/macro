use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Settings {
    pub link_id: Uuid,
    pub signature_on_replies_forwards: bool,
}

impl Settings {
    pub fn new(api_settings: crate::email::api::settings::Settings, link_id: Uuid) -> Self {
        Settings {
            link_id,
            signature_on_replies_forwards: api_settings
                .signature_on_replies_forwards
                .unwrap_or(false),
        }
    }
}

impl From<crate::email::db::settings::Settings> for Settings {
    fn from(db_settings: crate::email::db::settings::Settings) -> Self {
        Settings {
            link_id: db_settings.link_id,
            signature_on_replies_forwards: db_settings.signature_on_replies_forwards,
        }
    }
}

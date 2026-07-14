use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Settings {
    pub link_id: Uuid,
    pub signature_on_replies_forwards: bool,
    pub signature: Option<String>,
}

impl From<crate::email::db::settings::Settings> for Settings {
    fn from(db_settings: crate::email::db::settings::Settings) -> Self {
        Settings {
            link_id: db_settings.link_id,
            signature_on_replies_forwards: db_settings.signature_on_replies_forwards,
            signature: db_settings.signature,
        }
    }
}

/// A partial update to a link's settings. `None` fields are left unchanged.
#[derive(Debug, Clone)]
pub struct SettingsPatch {
    pub link_id: Uuid,
    pub signature_on_replies_forwards: Option<bool>,
    pub signature: Option<String>,
}

impl SettingsPatch {
    pub fn new(api_settings: crate::email::api::settings::Settings, link_id: Uuid) -> Self {
        SettingsPatch {
            link_id,
            signature_on_replies_forwards: api_settings.signature_on_replies_forwards,
            signature: api_settings.signature,
        }
    }
}

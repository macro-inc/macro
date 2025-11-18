use crate::api::settings::Settings;
use crate::service;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "UPPERCASE")]
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

impl std::fmt::Display for UserProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl From<crate::email::db::link::UserProvider> for UserProvider {
    fn from(provider: crate::email::db::link::UserProvider) -> Self {
        match provider {
            crate::email::db::link::UserProvider::Gmail => UserProvider::Gmail,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Link {
    pub id: Uuid,
    pub macro_id: String,
    pub fusionauth_user_id: String,
    pub email_address: String,
    pub provider: UserProvider,
    pub is_sync_active: bool,
    pub signature: Option<String>,
    pub settings: Settings,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Link {
    pub fn new(source: service::link::Link, signature: Option<String>, settings: Settings) -> Self {
        Link {
            id: source.id,
            macro_id: source.macro_id,
            fusionauth_user_id: source.fusionauth_user_id,
            email_address: source.email_address,
            provider: UserProvider::from(source.provider),
            is_sync_active: source.is_sync_active,
            signature,
            settings,
            created_at: source.created_at,
            updated_at: source.updated_at,
        }
    }
}

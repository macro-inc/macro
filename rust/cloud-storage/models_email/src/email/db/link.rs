use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[sqlx(type_name = "email_user_provider_enum", rename_all = "UPPERCASE")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub id: Uuid,
    pub macro_id: String,
    pub fusionauth_user_id: String,
    pub email_address: String,
    pub provider: UserProvider,
    pub is_sync_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<crate::email::service::link::Link> for Link {
    fn from(service_link: crate::email::service::link::Link) -> Self {
        Self {
            id: service_link.id,
            macro_id: service_link.macro_id,
            fusionauth_user_id: service_link.fusionauth_user_id,
            email_address: service_link.email_address.to_lowercase(),
            provider: service_link.provider,
            is_sync_active: service_link.is_sync_active,
            created_at: service_link.created_at,
            updated_at: service_link.updated_at,
        }
    }
}

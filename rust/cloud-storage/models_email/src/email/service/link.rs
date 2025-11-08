pub use crate::email::db::link::UserProvider;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
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

impl From<crate::email::db::link::Link> for Link {
    fn from(db_link: crate::email::db::link::Link) -> Self {
        Self {
            id: db_link.id,
            macro_id: db_link.macro_id,
            fusionauth_user_id: db_link.fusionauth_user_id,
            email_address: db_link.email_address,
            provider: db_link.provider,
            is_sync_active: db_link.is_sync_active,
            created_at: db_link.created_at,
            updated_at: db_link.updated_at,
        }
    }
}

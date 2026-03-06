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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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

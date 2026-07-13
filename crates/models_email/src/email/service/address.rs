use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::HashMap;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct ContactInfo {
    pub email: String,
    pub name: Option<String>,
    pub photo_url: Option<String>,
}

// temporary struct until FE moves to using email field instead of email_address
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct ContactInfoLegacy {
    pub email: String,
    pub email_address: String,
    pub name: Option<String>,
    pub photo_url: Option<String>,
}

#[derive(FromRow, Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ContactInfoWithInteraction {
    #[serde(flatten)]
    pub extra: ContactInfoLegacy,
    pub last_interaction: DateTime<Utc>,
}

impl From<crate::email::db::contact::ContactWithInteraction> for ContactInfoWithInteraction {
    fn from(db_contact: crate::email::db::contact::ContactWithInteraction) -> Self {
        Self {
            extra: ContactInfoLegacy {
                email: db_contact.email_address.clone(),
                email_address: db_contact.email_address,
                name: db_contact.name,
                photo_url: db_contact.photo_url,
            },
            last_interaction: db_contact.last_interaction,
        }
    }
}

pub type ContactsMap = HashMap<Uuid, Vec<ContactInfoWithInteraction>>;

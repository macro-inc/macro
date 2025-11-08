use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct Contact {
    #[schemars(with = "Option<String>")]
    pub id: Option<Uuid>,
    #[schemars(with = "String")]
    pub link_id: Uuid,
    pub name: Option<String>,
    pub email_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_photo_url: Option<String>,
    pub sfs_photo_url: Option<String>,
}

#[derive(Debug)]
pub struct ContactList {
    pub contacts: Vec<Contact>,
    pub next_sync_token: String,
}

impl From<crate::email::db::contact::Contact> for Contact {
    fn from(db_contact: crate::email::db::contact::Contact) -> Self {
        Self {
            id: Some(db_contact.id),
            link_id: db_contact.link_id,
            name: db_contact.name,
            email_address: db_contact.email_address,
            original_photo_url: db_contact.original_photo_url,
            sfs_photo_url: db_contact.sfs_photo_url,
        }
    }
}

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: Uuid,
    pub link_id: Uuid,
    pub name: Option<String>,
    pub email_address: Option<String>,
    pub original_photo_url: Option<String>,
    pub sfs_photo_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactWithInteraction {
    pub name: Option<String>,
    pub email_address: String,
    pub photo_url: Option<String>,
    pub last_interaction: DateTime<Utc>,
}

// used when upserting a contact that came directly from a new message coming from gmail. they
// don't include contact photos with the messages, so if there is one it will get picked up in
// the next daily contacts sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactPhotoless {
    pub id: Uuid,
    pub link_id: Uuid,
    pub name: Option<String>,
    pub email_address: String,
}

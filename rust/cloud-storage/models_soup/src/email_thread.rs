use chrono::{DateTime, Utc};
use doppleganger::Doppleganger;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::Contact)]
pub struct SoupContact {
    pub id: Uuid,
    pub link_id: Uuid,
    pub name: Option<String>,
    pub email_address: Option<String>,
    pub sfs_photo_url: Option<String>,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::AttachmentMacro)]
pub struct SoupMacroAttachment {
    pub thread_id: Uuid,
    pub db_id: Uuid,
    pub message_id: Uuid,
    pub item_id: Uuid,
    pub item_type: String,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::Attachment)]
pub struct SoupAttachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub provider_attachment_id: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub content_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::EmailThreadPreview)]
pub struct SoupEmailThreadPreview {
    pub id: Uuid,
    pub provider_id: Option<String>,
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,
    pub inbox_visible: bool,
    pub is_read: bool,
    pub is_draft: bool,
    pub is_important: bool,
    pub name: Option<String>,
    pub snippet: Option<String>,
    pub sender_email: Option<String>,
    pub sender_name: Option<String>,
    pub sender_photo_url: Option<String>,
    pub sort_ts: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::EnrichedEmailThreadPreview)]
pub struct SoupEnrichedEmailThreadPreview {
    pub thread: SoupEmailThreadPreview,
    pub attachments: Vec<SoupAttachment>,
    pub attachments_macro: Vec<SoupMacroAttachment>,
    pub participants: Vec<SoupContact>,
}

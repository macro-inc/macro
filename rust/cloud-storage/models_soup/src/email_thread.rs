use chrono::{DateTime, Utc};
use doppleganger::Doppleganger;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::SoupProperty;

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::Contact)]
#[serde(rename_all = "camelCase")]
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
#[dg(backward = email::domain::models::Label)]
#[serde(rename_all = "camelCase")]
pub struct SoupLabel {
    pub id: Uuid,
    pub link_id: Uuid,
    pub provider_label_id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub message_list_visibility: SoupMessageListVisibility,
    pub label_list_visibility: SoupLabelListVisibility,
    pub type_: SoupLabelType,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::MessageListVisibility)]
#[serde(rename_all = "camelCase")]
pub enum SoupMessageListVisibility {
    Show,
    Hide,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::LabelListVisibility)]
#[serde(rename_all = "camelCase")]
pub enum SoupLabelListVisibility {
    LabelShow,
    LabelShowIfUnread,
    LabelHide,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::LabelType)]
#[serde(rename_all = "camelCase")]
pub enum SoupLabelType {
    System,
    User,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::Attachment)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupEnrichedEmailThreadPreview {
    #[serde(flatten)]
    pub thread: SoupEmailThreadPreview,
    pub attachments: Vec<SoupAttachment>,
    pub participants: Vec<SoupContact>,
    pub labels: Vec<SoupLabel>,
    pub properties: Vec<SoupProperty>,
}

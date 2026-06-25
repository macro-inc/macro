use chrono::{DateTime, Utc};
use doppleganger::Doppleganger;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::SoupProperty;

/// A contact participating in an email thread as displayed in Soup.
#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::Contact)]
#[serde(rename_all = "camelCase")]
pub struct SoupContact {
    /// Contact id.
    pub id: Uuid,
    /// Connected account link id for the contact.
    pub link_id: Uuid,
    /// Contact display name.
    pub name: Option<String>,
    /// Contact email address.
    pub email_address: Option<String>,
    /// Contact photo URL from SFS, if available.
    pub sfs_photo_url: Option<String>,
}

/// An email label as displayed in Soup.
#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::Label)]
#[serde(rename_all = "camelCase")]
pub struct SoupLabel {
    /// Label id.
    pub id: Uuid,
    /// Connected account link id for the label.
    pub link_id: Uuid,
    /// Provider-specific label id.
    pub provider_label_id: String,
    /// Label display name.
    pub name: String,
    /// Timestamp when the label was created.
    pub created_at: DateTime<Utc>,
    /// Label visibility in message lists.
    pub message_list_visibility: SoupMessageListVisibility,
    /// Label visibility in label lists.
    pub label_list_visibility: SoupLabelListVisibility,
    /// Label type.
    pub type_: SoupLabelType,
}

/// Gmail-style message list visibility for a label.
#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::MessageListVisibility)]
#[serde(rename_all = "camelCase")]
pub enum SoupMessageListVisibility {
    /// Show the label in message lists.
    Show,
    /// Hide the label in message lists.
    Hide,
}

/// Gmail-style label list visibility.
#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::LabelListVisibility)]
#[serde(rename_all = "camelCase")]
pub enum SoupLabelListVisibility {
    /// Always show the label in label lists.
    LabelShow,
    /// Show the label in label lists only when unread.
    LabelShowIfUnread,
    /// Hide the label in label lists.
    LabelHide,
}

/// Whether an email label is provider-created or user-created.
#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::LabelType)]
#[serde(rename_all = "camelCase")]
pub enum SoupLabelType {
    /// System label created by the provider.
    System,
    /// User-created label.
    User,
}

/// An email attachment as displayed in Soup.
#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::Attachment)]
#[serde(rename_all = "camelCase")]
pub struct SoupAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Message id that owns this attachment.
    pub message_id: Uuid,
    /// Provider-specific attachment id.
    pub provider_attachment_id: Option<String>,
    /// Attachment filename.
    pub filename: Option<String>,
    /// Attachment MIME type.
    pub mime_type: Option<String>,
    /// Attachment size in bytes.
    pub size_bytes: Option<i64>,
    /// Content id for inline attachments.
    pub content_id: Option<String>,
    /// Timestamp when the attachment was created.
    pub created_at: DateTime<Utc>,
}

/// Email thread preview data as displayed in Soup.
#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[dg(backward = email::domain::models::EmailThreadPreview)]
#[serde(rename_all = "camelCase")]
pub struct SoupEmailThreadPreview {
    /// Thread id.
    pub id: Uuid,
    /// Provider-specific thread id.
    pub provider_id: Option<String>,
    /// Owner user id.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,
    /// Whether the thread should appear in the inbox.
    pub inbox_visible: bool,
    /// Whether the thread has been read.
    pub is_read: bool,
    /// Whether the thread contains a draft.
    pub is_draft: bool,
    /// Whether the thread is marked important.
    pub is_important: bool,
    /// Thread display name or subject.
    pub name: Option<String>,
    /// Thread snippet.
    pub snippet: Option<String>,
    /// Sender email address for the preview.
    pub sender_email: Option<String>,
    /// Sender display name for the preview.
    pub sender_name: Option<String>,
    /// Sender photo URL for the preview.
    pub sender_photo_url: Option<String>,
    /// Timestamp used for email thread sorting.
    pub sort_ts: DateTime<Utc>,
    /// Timestamp when the thread was created.
    pub created_at: DateTime<Utc>,
    /// Timestamp when the thread was last updated.
    pub updated_at: DateTime<Utc>,
    /// Timestamp when the requesting user last viewed the thread.
    pub viewed_at: Option<DateTime<Utc>>,
    /// Project id associated with the thread.
    pub project_id: Option<String>,
}

/// Email thread preview enriched with related metadata for Soup.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupEnrichedEmailThreadPreview {
    /// Base email thread preview.
    #[serde(flatten)]
    pub thread: SoupEmailThreadPreview,
    /// Attachments on the thread.
    pub attachments: Vec<SoupAttachment>,
    /// Contacts participating in the thread.
    pub participants: Vec<SoupContact>,
    /// Labels attached to the thread.
    pub labels: Vec<SoupLabel>,
    /// Properties attached to the thread.
    pub properties: Vec<SoupProperty>,
}

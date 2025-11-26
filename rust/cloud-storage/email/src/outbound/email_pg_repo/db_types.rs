use crate::domain::models::{
    Attachment, AttachmentMacro, EmailThreadPreview, Label, LabelListVisibility, LabelType,
    MessageListVisibility,
};
use chrono::{DateTime, Utc};
use doppleganger::Doppleganger;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

#[derive(Doppleganger)]
#[dg(forward = AttachmentMacro)]
pub struct AttachmentMacroDbRow {
    #[dg(rename = "db_id")]
    pub id: Uuid,
    pub message_id: Uuid,
    pub item_id: Uuid,
    pub item_type: String,
    #[expect(
        dead_code,
        reason = "We need this field to use query_as with the current query, but we never read it"
    )]
    #[dg(ignore)]
    pub(crate) created_at: DateTime<Utc>,
    pub thread_id: Uuid,
}

#[derive(Doppleganger)]
#[dg(forward = Attachment)]
pub struct AttachmentDbRow {
    pub id: Uuid,
    pub message_id: Uuid,
    // a different value is returned by the gmail API for this each time you fetch a message -
    // don't make the mistake of using it to uniquely identify an attachment
    pub provider_attachment_id: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub content_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub thread_id: Uuid,
}

/// thread summary returned in preview cursor endpoint
#[derive(Debug, Clone)]
pub struct ThreadPreviewCursorDbRow {
    pub id: Uuid,
    pub provider_id: Option<String>,
    pub inbox_visible: bool,
    pub is_read: bool,
    pub is_draft: bool,
    pub is_important: bool,
    pub sort_ts: DateTime<Utc>,
    pub name: Option<String>,
    pub snippet: Option<String>,
    pub sender_email: Option<String>,
    pub sender_name: Option<String>,
    pub sender_photo_url: Option<String>,
    pub viewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::Type, Clone, Copy, PartialEq, Eq, Doppleganger)]
#[dg(forward = MessageListVisibility)]
#[sqlx(
    type_name = "email_message_list_visibility_enum",
    rename_all = "PascalCase"
)]
pub enum MessageListVisibilityDbRow {
    Show,
    Hide,
}

#[derive(Debug, sqlx::Type, Clone, Copy, PartialEq, Eq, Doppleganger)]
#[dg(forward = LabelListVisibility)]
#[sqlx(
    type_name = "email_label_list_visibility_enum",
    rename_all = "PascalCase"
)]
#[expect(clippy::enum_variant_names, reason = "Matches names from Gmail API")]
pub enum LabelListVisibilityDbRow {
    LabelShow,
    LabelShowIfUnread,
    LabelHide,
}

#[derive(Debug, sqlx::Type, Clone, Copy, PartialEq, Eq, Doppleganger)]
#[dg(forward = LabelType)]
#[sqlx(type_name = "email_label_type_enum", rename_all = "PascalCase")]
pub enum LabelTypeDbRow {
    System,
    User,
}

#[derive(Doppleganger)]
#[dg(forward = Label)]
#[derive(Debug, Clone)]
pub struct LabelDbRow {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub link_id: Uuid,
    pub provider_label_id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub message_list_visibility: MessageListVisibilityDbRow,
    pub label_list_visibility: LabelListVisibilityDbRow,
    pub type_: LabelTypeDbRow,
}

impl ThreadPreviewCursorDbRow {
    pub fn with_user_id(self, owner_id: MacroUserIdStr<'_>) -> EmailThreadPreview {
        let ThreadPreviewCursorDbRow {
            id,
            provider_id,
            inbox_visible,
            is_read,
            is_draft,
            is_important,
            sort_ts,
            name,
            snippet,
            sender_email,
            sender_name,
            sender_photo_url,
            viewed_at,
            created_at,
            updated_at,
        } = self;

        EmailThreadPreview {
            id,
            provider_id,
            owner_id: owner_id.into_owned(),
            inbox_visible,
            is_read,
            is_draft,
            is_important,
            name,
            snippet,
            sender_email,
            sender_name,
            sender_photo_url,
            sort_ts,
            created_at,
            updated_at,
            viewed_at,
        }
    }
}

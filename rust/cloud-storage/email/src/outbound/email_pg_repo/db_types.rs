use crate::domain::models::{Attachment, AttachmentMacro, ThreadPreviewCursor};
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

pub struct AttachmentMacroDbRow {
    pub id: Uuid,
    pub message_id: Uuid,
    pub item_id: Uuid,
    pub item_type: String,
    #[expect(
        dead_code,
        reason = "We need this field to use query_as with the current query, but we never read it"
    )]
    pub created_at: DateTime<Utc>,
    pub thread_id: Uuid,
}

impl AttachmentMacroDbRow {
    pub fn into_model(self) -> AttachmentMacro {
        let AttachmentMacroDbRow {
            id,
            message_id,
            item_id,
            item_type,
            created_at: _,
            thread_id,
        } = self;
        AttachmentMacro {
            thread_id,
            db_id: id,
            message_id,
            item_id,
            item_type,
        }
    }
}

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

impl AttachmentDbRow {
    pub fn into_model(self) -> Attachment {
        let AttachmentDbRow {
            id,
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            content_id,
            created_at,
            thread_id,
        } = self;

        Attachment {
            id,
            thread_id,
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            content_id,
            created_at,
        }
    }
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

impl ThreadPreviewCursorDbRow {
    pub fn with_user_id(self, owner_id: MacroUserIdStr<'_>) -> ThreadPreviewCursor {
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

        ThreadPreviewCursor {
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

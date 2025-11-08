use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Attachments of a message, as sent to us by the provider.
#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
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
}

/// Attachments of a message created when sending a message/draft through Macro FE. references
/// a macro item (document, canvas, etc). These don't actually get sent to the provider when
/// sending a message, but we store them so we can display the pills for the Macro objects in the FE
/// when displaying the message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentMacro {
    pub id: Uuid,
    pub message_id: Uuid,
    pub item_id: Uuid,
    pub item_type: String,
    pub created_at: DateTime<Utc>,
}

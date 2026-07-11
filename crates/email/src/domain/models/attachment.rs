use chrono::{DateTime, Utc};
use models_pagination::Identify;
use uuid::Uuid;

#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct Attachment {
    pub id: Uuid,
    #[allow(unused)]
    pub(crate) thread_id: Uuid,
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

impl Identify for Attachment {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }
}

/// A provider attachment on a message.
#[derive(Debug, Clone)]
pub struct MessageAttachment {
    /// Database ID of the attachment.
    pub db_id: uuid::Uuid,
    /// Provider attachment ID.
    pub provider_id: Option<String>,
    /// Original filename.
    pub filename: Option<String>,
    /// MIME type.
    pub mime_type: Option<String>,
    /// Size in bytes.
    pub size_bytes: Option<i64>,
    /// SFS (static file storage) ID.
    pub sfs_id: Option<uuid::Uuid>,
    /// Content ID (for inline attachments).
    pub content_id: Option<String>,
}

/// A draft attachment uploaded to S3.
#[derive(Debug, Clone)]
pub struct AttachmentDraft {
    /// Unique ID of the draft attachment record.
    pub id: uuid::Uuid,
    /// ID of the draft message this attachment belongs to.
    pub draft_id: uuid::Uuid,
    /// Original file name.
    pub file_name: String,
    /// MIME type.
    pub content_type: String,
    /// SHA-256 hash.
    pub sha: String,
    /// File size in bytes.
    pub size: i32,
    /// S3 object key.
    pub s3_key: String,
}

/// A forwarded attachment linking a draft to an original message's attachment.
#[derive(Debug, Clone)]
pub struct AttachmentForwarded {
    /// UUID of the original attachment.
    pub attachment_id: uuid::Uuid,
    /// ID of the draft message.
    pub draft_id: uuid::Uuid,
    /// Provider attachment ID for fetching from the provider API.
    pub provider_attachment_id: Option<String>,
    /// Provider message ID of the original message.
    pub message_provider_id: String,
    /// Original filename.
    pub filename: Option<String>,
    /// MIME type.
    pub mime_type: Option<String>,
    /// Size in bytes.
    pub size_bytes: Option<i64>,
}

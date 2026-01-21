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
    pub sfs_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentSfs {
    pub id: Uuid,
    pub attachment_id: Option<Uuid>,
    pub sfs_id: Uuid,
}

impl From<crate::service::attachment::AttachmentSfs> for AttachmentSfs {
    fn from(service: crate::service::attachment::AttachmentSfs) -> Self {
        Self {
            id: service.id,
            attachment_id: service.attachment_id,
            sfs_id: service.sfs_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AttachmentDraft {
    /// Unique identifier for the attachment.
    pub id: Uuid,
    /// The ID of the draft message this attachment belongs to.
    pub draft_id: Uuid,
    /// Original file name of the attachment.
    pub file_name: String,
    /// MIME type of the attachment (e.g., "application/pdf", "image/png").
    pub content_type: String,
    /// SHA-256 hash of the file content for integrity verification.
    pub sha: String,
    /// File size in bytes.
    pub size: i32,
    /// S3 object key where the attachment content is stored.
    pub s3_key: String,
}

impl From<crate::service::attachment::AttachmentDraft> for AttachmentDraft {
    fn from(service: crate::service::attachment::AttachmentDraft) -> Self {
        Self {
            id: service.id,
            draft_id: service.draft_id,
            file_name: service.file_name,
            content_type: service.content_type,
            sha: service.sha,
            size: service.size,
            s3_key: service.s3_key,
        }
    }
}

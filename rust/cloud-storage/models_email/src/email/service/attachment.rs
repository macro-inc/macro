use crate::db;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

/// Attachments of a message, as sent to us by the provider.
#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct Attachment {
    #[schemars(with = "Option<String>")]
    pub db_id: Option<Uuid>,
    // a different value is returned by the gmail API for this each time you fetch a message -
    // don't make the mistake of using it to uniquely identify an attachment
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    #[schemars(with = "Option<String>")]
    pub sfs_id: Option<Uuid>,
    pub content_id: Option<String>,
}

/// Attachments of a message created when sending a message/draft through Macro FE. references
/// a macro item (document, canvas, etc). These don't actually get sent to the provider when
/// sending a message, but we store them so we can display the pills for the Macro objects in the FE
/// when displaying the message.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AttachmentMacro {
    #[schemars(with = "Option<String>")]
    pub db_id: Option<Uuid>,
    #[schemars(with = "Option<String>")]
    pub message_id: Option<Uuid>,
    #[schemars(with = "String")]
    pub item_id: Uuid,
    pub item_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentSfs {
    pub id: Uuid,
    pub attachment_id: Option<Uuid>,
    pub sfs_id: Uuid,
}

impl From<db::attachment::AttachmentSfs> for AttachmentSfs {
    fn from(db: db::attachment::AttachmentSfs) -> Self {
        Self {
            id: db.id,
            attachment_id: db.attachment_id,
            sfs_id: db.sfs_id,
        }
    }
}

/// The metadata of an attachment we need to upload it to DSS.
#[derive(Clone, Debug, FromRow, Eq, PartialEq, Serialize, Deserialize)]
pub struct AttachmentUploadMetadata {
    pub attachment_db_id: Uuid,
    pub email_provider_id: String,
    pub provider_attachment_id: String,
    pub mime_type: String,
    pub filename: Option<String>,
    pub internal_date_ts: DateTime<Utc>,
    pub message_db_id: Uuid,
    pub thread_db_id: Uuid,
    pub sender_email: String,
    pub subject: Option<String>,
}

#[derive(Clone, Debug, FromRow, Eq, PartialEq, Serialize, Deserialize)]
pub struct AttachmentUploadArgs {
    pub attachment_metadata: AttachmentUploadMetadata,
    pub recipient_emails: Vec<String>,
    pub backfill: bool,
    pub upload_destination: AttachmentUploadDestination,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttachmentUploadDestination {
    Dss,
    Sfs,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
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

impl From<crate::db::attachment::AttachmentDraft> for AttachmentDraft {
    fn from(db: crate::db::attachment::AttachmentDraft) -> Self {
        Self {
            id: db.id,
            draft_id: db.draft_id,
            file_name: db.file_name,
            content_type: db.content_type,
            sha: db.sha,
            size: db.size,
            s3_key: db.s3_key,
        }
    }
}

/// The attachment data we need to include when sending a message to a provider.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AttachmentToSend {
    pub file_name: String,
    pub content_type: String,
    pub data: Vec<u8>,
}

use crate::domain::models::{
    Attachment, AttachmentDraft, AttachmentForwarded, ContactInfo, EmailThreadPreview, Label,
    LabelListVisibility, LabelType, Link, MessageAttachment, MessageLabel, MessageListVisibility,
    MessageRow, RecipientType, SimpleMessageInfo, ThreadRow,
};
use chrono::{DateTime, Utc};
use doppleganger::{Doppleganger, Mirror};
use macro_user_id::{cowlike::CowLike, email::EmailStr, user_id::MacroUserIdStr};
use sqlx::Type;
use uuid::Uuid;

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
    pub project_id: Option<String>,
    /// The macro user ID of the thread owner, resolved from email_links.
    pub owner_id: String,
    /// The id of the email_link (inbox) this thread belongs to.
    pub link_id: Uuid,
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
    pub fn into_preview(self) -> EmailThreadPreview {
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
            project_id,
            owner_id,
            link_id,
        } = self;

        EmailThreadPreview {
            id,
            provider_id,
            owner_id: MacroUserIdStr::parse_from_str(&owner_id)
                .expect("invalid macro_id in email_links")
                .into_owned(),
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
            project_id,
            link_id,
        }
    }
}

#[derive(Type, Debug, Clone, Copy, Doppleganger)]
#[sqlx(type_name = "email_user_provider_enum", rename_all = "UPPERCASE")]
#[dg(forward = crate::domain::models::UserProvider)]
pub enum DbUserProvider {
    Gmail,
}

#[derive(Debug, Clone)]
pub(crate) struct DbLink {
    pub id: Uuid,
    pub macro_id: String,
    pub fusionauth_user_id: String,
    pub email_address: String,
    pub provider: DbUserProvider,
    pub is_sync_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// DB row for a thread record.
pub struct DbThreadRow {
    pub id: uuid::Uuid,
    pub provider_id: Option<String>,
    pub link_id: uuid::Uuid,
    pub inbox_visible: bool,
    pub is_read: bool,
    pub latest_inbound_message_ts: Option<DateTime<Utc>>,
    pub latest_outbound_message_ts: Option<DateTime<Utc>>,
    pub latest_non_spam_message_ts: Option<DateTime<Utc>>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
    pub project_id: Option<String>,
}

impl From<DbThreadRow> for ThreadRow {
    fn from(row: DbThreadRow) -> Self {
        Self {
            db_id: row.id,
            provider_id: row.provider_id,
            link_id: row.link_id,
            inbox_visible: row.inbox_visible,
            is_read: row.is_read,
            latest_inbound_message_ts: row.latest_inbound_message_ts,
            latest_outbound_message_ts: row.latest_outbound_message_ts,
            latest_non_spam_message_ts: row.latest_non_spam_message_ts,
            created_at: row.created_at,
            updated_at: row.updated_at,
            project_id: row.project_id,
        }
    }
}

/// DB row for a message record.
pub struct DbMessageRow {
    pub id: uuid::Uuid,
    pub provider_id: Option<String>,
    pub thread_id: uuid::Uuid,
    pub provider_thread_id: Option<String>,
    pub replying_to_id: Option<uuid::Uuid>,
    pub global_id: Option<String>,
    pub link_id: uuid::Uuid,
    pub provider_history_id: Option<String>,
    pub internal_date_ts: Option<DateTime<Utc>>,
    pub snippet: Option<String>,
    pub size_estimate: Option<i64>,
    pub subject: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub has_attachments: bool,
    pub is_read: bool,
    pub is_starred: bool,
    pub is_sent: bool,
    pub is_draft: bool,
    pub body_text: Option<String>,
    pub body_html_sanitized: Option<String>,
    pub body_macro: Option<String>,
    pub headers_jsonb: Option<serde_json::Value>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

impl From<DbMessageRow> for MessageRow {
    fn from(row: DbMessageRow) -> Self {
        Self {
            db_id: row.id,
            provider_id: row.provider_id,
            thread_db_id: row.thread_id,
            provider_thread_id: row.provider_thread_id,
            replying_to_id: row.replying_to_id,
            global_id: row.global_id,
            link_id: row.link_id,
            subject: row.subject,
            snippet: row.snippet,
            provider_history_id: row.provider_history_id,
            internal_date_ts: row.internal_date_ts,
            sent_at: row.sent_at,
            size_estimate: row.size_estimate,
            is_read: row.is_read,
            is_starred: row.is_starred,
            is_sent: row.is_sent,
            is_draft: row.is_draft,
            has_attachments: row.has_attachments,
            body_text: row.body_text,
            body_html_sanitized: row.body_html_sanitized,
            body_macro: row.body_macro,
            headers_json: row.headers_jsonb,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// DB row for a message label, including the message_id for grouping.
pub struct DbMessageLabelRow {
    pub message_id: uuid::Uuid,
    pub id: uuid::Uuid,
    pub link_id: uuid::Uuid,
    pub provider_label_id: String,
    pub name: String,
    pub created_at: chrono::DateTime<Utc>,
    pub message_list_visibility: MessageListVisibilityDbRow,
    pub label_list_visibility: LabelListVisibilityDbRow,
    pub type_: LabelTypeDbRow,
}

impl From<DbMessageLabelRow> for (uuid::Uuid, MessageLabel) {
    fn from(row: DbMessageLabelRow) -> Self {
        let label = MessageLabel {
            id: Some(row.id),
            link_id: row.link_id,
            provider_label_id: row.provider_label_id,
            name: Some(row.name),
            created_at: row.created_at,
            message_list_visibility: Some(match row.message_list_visibility {
                MessageListVisibilityDbRow::Show => MessageListVisibility::Show,
                MessageListVisibilityDbRow::Hide => MessageListVisibility::Hide,
            }),
            label_list_visibility: Some(match row.label_list_visibility {
                LabelListVisibilityDbRow::LabelShow => LabelListVisibility::LabelShow,
                LabelListVisibilityDbRow::LabelShowIfUnread => {
                    LabelListVisibility::LabelShowIfUnread
                }
                LabelListVisibilityDbRow::LabelHide => LabelListVisibility::LabelHide,
            }),
            type_: Some(match row.type_ {
                LabelTypeDbRow::System => LabelType::System,
                LabelTypeDbRow::User => LabelType::User,
            }),
        };
        (row.message_id, label)
    }
}

/// DB row for a provider attachment, including the message_id for grouping.
pub struct DbMessageAttachmentRow {
    pub message_id: uuid::Uuid,
    pub id: uuid::Uuid,
    pub provider_attachment_id: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub sfs_id: Option<uuid::Uuid>,
    pub content_id: Option<String>,
}

impl From<DbMessageAttachmentRow> for (uuid::Uuid, MessageAttachment) {
    fn from(row: DbMessageAttachmentRow) -> Self {
        let att = MessageAttachment {
            db_id: row.id,
            provider_id: row.provider_attachment_id,
            filename: row.filename,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
            sfs_id: row.sfs_id,
            content_id: row.content_id,
        };
        (row.message_id, att)
    }
}

/// DB row for a draft attachment.
pub struct DbDraftAttachmentRow {
    pub draft_id: uuid::Uuid,
    pub id: uuid::Uuid,
    pub file_name: String,
    pub content_type: String,
    pub sha: String,
    pub size: i32,
    pub s3_key: String,
}

impl From<DbDraftAttachmentRow> for (uuid::Uuid, AttachmentDraft) {
    fn from(row: DbDraftAttachmentRow) -> Self {
        let att = AttachmentDraft {
            id: row.id,
            draft_id: row.draft_id,
            file_name: row.file_name,
            content_type: row.content_type,
            sha: row.sha,
            size: row.size,
            s3_key: row.s3_key,
        };
        (row.draft_id, att)
    }
}

/// DB row for a forwarded attachment.
pub struct DbForwardedAttachmentRow {
    pub draft_id: uuid::Uuid,
    pub attachment_id: uuid::Uuid,
    pub provider_attachment_id: Option<String>,
    pub message_provider_id: String,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
}

impl From<DbForwardedAttachmentRow> for (uuid::Uuid, AttachmentForwarded) {
    fn from(row: DbForwardedAttachmentRow) -> Self {
        let att = AttachmentForwarded {
            attachment_id: row.attachment_id,
            draft_id: row.draft_id,
            provider_attachment_id: row.provider_attachment_id,
            message_provider_id: row.message_provider_id,
            filename: row.filename,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
        };
        (row.draft_id, att)
    }
}

/// DB row for a sender contact, including the message_id for grouping.
pub struct DbSenderRow {
    pub message_id: uuid::Uuid,
    pub email_address: Option<String>,
    pub name: Option<String>,
    pub sfs_photo_url: Option<String>,
}

impl From<DbSenderRow> for (uuid::Uuid, ContactInfo) {
    fn from(row: DbSenderRow) -> Self {
        let contact = ContactInfo {
            email: row.email_address.unwrap_or_default(),
            name: row.name,
            photo_url: row.sfs_photo_url,
        };
        (row.message_id, contact)
    }
}

/// DB row for a recipient, including the message_id and recipient type.
pub struct DbRecipientRow {
    pub message_id: uuid::Uuid,
    pub email_address: String,
    pub name: Option<String>,
    pub sfs_photo_url: Option<String>,
    pub recipient_type: DbRecipientType,
}

/// DB-layer recipient type enum, matching the `email_recipient_type` postgres enum.
#[derive(Debug, sqlx::Type, Clone, Copy, PartialEq, Eq)]
#[sqlx(type_name = "email_recipient_type", rename_all = "UPPERCASE")]
pub enum DbRecipientType {
    /// To recipient.
    To,
    /// Cc recipient.
    Cc,
    /// Bcc recipient.
    Bcc,
}

impl From<DbRecipientType> for RecipientType {
    fn from(v: DbRecipientType) -> Self {
        match v {
            DbRecipientType::To => RecipientType::To,
            DbRecipientType::Cc => RecipientType::Cc,
            DbRecipientType::Bcc => RecipientType::Bcc,
        }
    }
}

impl From<DbRecipientRow> for (uuid::Uuid, ContactInfo, RecipientType) {
    fn from(row: DbRecipientRow) -> Self {
        let contact = ContactInfo {
            email: row.email_address,
            name: row.name,
            photo_url: row.sfs_photo_url,
        };
        (
            row.message_id,
            contact,
            RecipientType::from(row.recipient_type),
        )
    }
}

/// DB row for a simplified message used in draft validation queries.
pub(crate) struct DbSimpleMessageRow {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub provider_thread_id: Option<String>,
    pub headers_jsonb: Option<serde_json::Value>,
    pub is_sent: bool,
    pub is_draft: bool,
}

impl From<DbSimpleMessageRow> for SimpleMessageInfo {
    fn from(row: DbSimpleMessageRow) -> Self {
        Self {
            db_id: row.id,
            thread_db_id: row.thread_id,
            provider_thread_id: row.provider_thread_id,
            headers_json: row.headers_jsonb,
            is_sent: row.is_sent,
            is_draft: row.is_draft,
        }
    }
}

impl DbLink {
    pub(crate) fn try_into_model(self) -> Result<Link, macro_user_id::error::ParseErr> {
        let DbLink {
            id,
            macro_id,
            fusionauth_user_id,
            email_address,
            provider,
            is_sync_active,
            created_at,
            updated_at,
        } = self;

        Ok(Link {
            id,
            macro_id: MacroUserIdStr::parse_from_str(&macro_id)?.into_owned(),
            fusionauth_user_id,
            email_address: EmailStr::try_from(email_address)?,
            provider: DbUserProvider::mirror(provider),
            is_sync_active,
            created_at,
            updated_at,
        })
    }
}

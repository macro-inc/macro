use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::models::{
    AttachmentDraft, AttachmentForwarded, ContactInfo, Message, MessageAttachment, MessageLabel,
    RecipientType,
};

use super::label::{ApiLabelListVisibility, ApiLabelType, ApiMessageListVisibility};

/// API representation of a contact (sender or recipient).
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiContactInfo {
    pub email: String,
    pub name: Option<String>,
    pub photo_url: Option<String>,
}

impl From<ContactInfo> for ApiContactInfo {
    fn from(c: ContactInfo) -> Self {
        ApiContactInfo {
            email: c.email,
            name: c.name,
            photo_url: c.photo_url,
        }
    }
}

/// Recipient type for a message.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub enum ApiRecipientType {
    To,
    Cc,
    Bcc,
}

impl From<RecipientType> for ApiRecipientType {
    fn from(r: RecipientType) -> Self {
        match r {
            RecipientType::To => ApiRecipientType::To,
            RecipientType::Cc => ApiRecipientType::Cc,
            RecipientType::Bcc => ApiRecipientType::Bcc,
        }
    }
}

/// API representation of a label on a message.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiMessageLabel {
    pub id: Option<Uuid>,
    pub link_id: Uuid,
    pub provider_label_id: String,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub message_list_visibility: Option<ApiMessageListVisibility>,
    pub label_list_visibility: Option<ApiLabelListVisibility>,
    pub type_: Option<ApiLabelType>,
}

impl From<MessageLabel> for ApiMessageLabel {
    fn from(l: MessageLabel) -> Self {
        ApiMessageLabel {
            id: l.id,
            link_id: l.link_id,
            provider_label_id: l.provider_label_id,
            name: l.name,
            created_at: l.created_at,
            message_list_visibility: l
                .message_list_visibility
                .map(ApiMessageListVisibility::from),
            label_list_visibility: l.label_list_visibility.map(ApiLabelListVisibility::from),
            type_: l.type_.map(ApiLabelType::from),
        }
    }
}

/// API representation of a provider attachment on a message.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiMessageAttachment {
    pub db_id: Uuid,
    pub provider_id: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub sfs_id: Option<Uuid>,
    pub content_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
}

impl From<MessageAttachment> for ApiMessageAttachment {
    fn from(a: MessageAttachment) -> Self {
        ApiMessageAttachment {
            db_id: a.db_id,
            provider_id: a.provider_id,
            filename: a.filename,
            mime_type: a.mime_type,
            size_bytes: a.size_bytes,
            sfs_id: a.sfs_id,
            content_id: a.content_id,
            data_url: None,
        }
    }
}

/// API representation of a draft attachment on a message.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiAttachmentDraft {
    pub id: Uuid,
    pub draft_id: Uuid,
    pub file_name: String,
    pub content_type: String,
    pub sha: String,
    pub size: i32,
    pub s3_key: String,
}

impl From<AttachmentDraft> for ApiAttachmentDraft {
    fn from(a: AttachmentDraft) -> Self {
        ApiAttachmentDraft {
            id: a.id,
            draft_id: a.draft_id,
            file_name: a.file_name,
            content_type: a.content_type,
            sha: a.sha,
            size: a.size,
            s3_key: a.s3_key,
        }
    }
}

/// API representation of a forwarded attachment on a message.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiAttachmentForwarded {
    pub attachment_id: Uuid,
    pub draft_id: Uuid,
    pub provider_attachment_id: Option<String>,
    pub message_provider_id: String,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
}

impl From<AttachmentForwarded> for ApiAttachmentForwarded {
    fn from(a: AttachmentForwarded) -> Self {
        ApiAttachmentForwarded {
            attachment_id: a.attachment_id,
            draft_id: a.draft_id,
            provider_attachment_id: a.provider_attachment_id,
            message_provider_id: a.message_provider_id,
            filename: a.filename,
            mime_type: a.mime_type,
            size_bytes: a.size_bytes,
        }
    }
}

/// API representation of a fully assembled email message.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiMessage {
    pub db_id: Uuid,
    pub provider_id: Option<String>,
    pub thread_db_id: Uuid,
    pub provider_thread_id: Option<String>,
    pub replying_to_id: Option<Uuid>,
    pub global_id: Option<String>,
    pub link_id: Uuid,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub provider_history_id: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub internal_date_ts: Option<DateTime<Utc>>,
    pub size_estimate: Option<i64>,
    pub is_read: bool,
    pub is_starred: bool,
    pub is_sent: bool,
    pub is_draft: bool,
    pub has_attachments: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_send_time: Option<DateTime<Utc>>,
    pub from: Option<ApiContactInfo>,
    pub to: Vec<ApiContactInfo>,
    pub cc: Vec<ApiContactInfo>,
    pub bcc: Vec<ApiContactInfo>,
    pub labels: Vec<ApiMessageLabel>,
    pub body_text: Option<String>,
    pub body_html_sanitized: Option<String>,
    pub body_macro: Option<String>,
    pub body_replyless: Option<String>,
    pub attachments: Vec<ApiMessageAttachment>,
    pub attachments_draft: Vec<ApiAttachmentDraft>,
    pub attachments_forwarded: Vec<ApiAttachmentForwarded>,
    pub headers_json: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Message> for ApiMessage {
    fn from(m: Message) -> Self {
        ApiMessage {
            db_id: m.db_id,
            provider_id: m.provider_id,
            thread_db_id: m.thread_db_id,
            provider_thread_id: m.provider_thread_id,
            replying_to_id: m.replying_to_id,
            global_id: m.global_id,
            link_id: m.link_id,
            subject: m.subject,
            snippet: m.snippet,
            provider_history_id: m.provider_history_id,
            sent_at: m.sent_at,
            internal_date_ts: m.internal_date_ts,
            size_estimate: m.size_estimate,
            is_read: m.is_read,
            is_starred: m.is_starred,
            is_sent: m.is_sent,
            is_draft: m.is_draft,
            has_attachments: m.has_attachments,
            scheduled_send_time: m.scheduled_send_time,
            from: m.from.map(ApiContactInfo::from),
            to: m.to.into_iter().map(ApiContactInfo::from).collect(),
            cc: m.cc.into_iter().map(ApiContactInfo::from).collect(),
            bcc: m.bcc.into_iter().map(ApiContactInfo::from).collect(),
            labels: m.labels.into_iter().map(ApiMessageLabel::from).collect(),
            body_text: m.body_text,
            body_html_sanitized: m.body_html_sanitized,
            body_macro: m.body_macro,
            body_replyless: m.body_replyless,
            attachments: m
                .attachments
                .into_iter()
                .map(ApiMessageAttachment::from)
                .collect(),
            attachments_draft: m
                .attachments_draft
                .into_iter()
                .map(ApiAttachmentDraft::from)
                .collect(),
            attachments_forwarded: m
                .attachments_forwarded
                .into_iter()
                .map(ApiAttachmentForwarded::from)
                .collect(),
            headers_json: m.headers_json,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

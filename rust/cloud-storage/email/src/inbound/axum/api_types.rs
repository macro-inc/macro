use chrono::{DateTime, Utc};
use models_pagination::{PaginatedOpaqueCursor, SimpleSortMethod};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::models::{
    Attachment, AttachmentMacro, Contact, EmailThreadPreview, EnrichedEmailThreadPreview,
};

/// common types of sorts based on timestamps
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiSortMethod {
    /// we are sorting by the viewed_at time
    ViewedAt,
    /// we are sorting by the updated_at time
    UpdatedAt,
    /// we are sorting by the created_at time
    CreatedAt,
    /// we are sorting by the viewed/updated time
    ViewedUpdated,
}

impl ApiSortMethod {
    pub fn into_simple_sort(self) -> SimpleSortMethod {
        match self {
            ApiSortMethod::ViewedAt => SimpleSortMethod::ViewedAt,
            ApiSortMethod::UpdatedAt => SimpleSortMethod::UpdatedAt,
            ApiSortMethod::CreatedAt => SimpleSortMethod::CreatedAt,
            ApiSortMethod::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
struct ApiThreadPreviewCursor {
    #[serde(flatten)]
    thread: ApiThreadPreviewCursorInner,
    attachments: Vec<ApiAttachment>,
    macro_attachments: Vec<ApiAttachmentMacro>,
    contacts: Vec<ApiContact>,
    frecency_score: Option<f64>,
}

impl ApiThreadPreviewCursor {
    #[inline]
    fn new(model: EnrichedEmailThreadPreview) -> Self {
        let EnrichedEmailThreadPreview {
            thread,
            attachments,
            attachments_macro,
            frecency_score,
            participants,
        } = model;

        ApiThreadPreviewCursor {
            thread: ApiThreadPreviewCursorInner::new(thread),
            attachments: attachments.into_iter().map(ApiAttachment::new).collect(),
            macro_attachments: attachments_macro
                .into_iter()
                .map(ApiAttachmentMacro::new)
                .collect(),
            contacts: participants.into_iter().map(ApiContact::new).collect(),
            frecency_score,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiThreadPreviewCursorInner {
    id: Uuid,
    provider_id: Option<String>,
    owner_id: String,
    inbox_visible: bool,
    is_read: bool,
    is_draft: bool,
    is_important: bool,
    name: Option<String>,
    snippet: Option<String>,
    sender_email: Option<String>,
    sender_name: Option<String>,
    sender_photo_url: Option<String>,

    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    sort_ts: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    created_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    updated_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[schema(value_type = i64, nullable = true)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "Option<i64>"))]
    viewed_at: Option<DateTime<Utc>>,
}

impl ApiThreadPreviewCursorInner {
    #[inline]
    fn new(thread: EmailThreadPreview) -> Self {
        let EmailThreadPreview {
            id,
            provider_id,
            owner_id,
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
        } = thread;

        Self {
            id,
            provider_id,
            owner_id: owner_id.to_string(),
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

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiAttachment {
    id: Uuid,
    message_id: Uuid,
    // a different value is returned by the gmail API for this each time you fetch a message -
    // don't make the mistake of using it to uniquely identify an attachment
    provider_attachment_id: Option<String>,
    filename: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    content_id: Option<String>,

    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    created_at: DateTime<Utc>,
}

impl ApiAttachment {
    #[inline]
    fn new(model: Attachment) -> Self {
        let Attachment {
            id,
            thread_id: _,
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            content_id,
            created_at,
        } = model;

        ApiAttachment {
            id,
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

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiAttachmentMacro {
    db_id: Uuid,
    message_id: Uuid,
    item_id: Uuid,
    item_type: String,
}

impl ApiAttachmentMacro {
    #[inline]
    fn new(model: AttachmentMacro) -> Self {
        let AttachmentMacro {
            thread_id: _,
            db_id,
            message_id,
            item_id,
            item_type,
        } = model;
        ApiAttachmentMacro {
            db_id,
            message_id,
            item_id,
            item_type,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiContact {
    id: Uuid,
    link_id: Uuid,
    name: Option<String>,
    email_address: Option<String>,
    sfs_photo_url: Option<String>,
}

impl ApiContact {
    #[inline]
    fn new(model: Contact) -> Self {
        let Contact {
            id,
            thread_id: _,
            link_id,
            name,
            email_address,
            sfs_photo_url,
        } = model;

        ApiContact {
            id,
            link_id,
            name,
            email_address,
            sfs_photo_url,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiPaginatedThreadCursor {
    items: Vec<ApiThreadPreviewCursor>,
    next_cursor: Option<String>,
}

impl ApiPaginatedThreadCursor {
    #[inline]
    pub(crate) fn new(model: PaginatedOpaqueCursor<EnrichedEmailThreadPreview>) -> Self {
        let PaginatedOpaqueCursor {
            items, next_cursor, ..
        } = model;
        ApiPaginatedThreadCursor {
            items: items.into_iter().map(ApiThreadPreviewCursor::new).collect(),
            next_cursor,
        }
    }
}

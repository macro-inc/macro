use chrono::{DateTime, Utc};
use doppleganger::{Doppleganger, Mirror};
use frecency::domain::models::AggregateFrecency;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{PaginatedOpaqueCursor, SimpleSortMethod};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::models::{
    Attachment, AttachmentMacro, Contact, EmailThreadPreview, EmailThreadPreviewMetadata,
    EnrichedEmailThreadPreview, Label, LabelListVisibility, LabelType, MessageListVisibility,
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

#[derive(Debug, ToSchema, Serialize, Deserialize, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
#[dg(backward = EnrichedEmailThreadPreview)]
struct ApiThreadPreviewCursor {
    #[serde(flatten)]
    thread: ApiThreadPreviewCursorInner,
    attachments: Vec<ApiAttachment>,
    #[dg(rename = "attachments_macro")]
    macro_attachments: Vec<ApiAttachmentMacro>,
    #[dg(rename = "participants")]
    contacts: Vec<ApiContact>,
    labels: Vec<ApiLabel>,
    metadata: APIEmailThreadPreviewMetadata,
    #[dg(map = map_frecency)]
    frecency_score: Option<f64>,
}

fn map_frecency(f: Option<AggregateFrecency>) -> Option<f64> {
    f.map(|f| f.data.frecency_score)
}

#[derive(Debug, ToSchema, Serialize, Deserialize, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
#[dg(backward = EmailThreadPreview)]
pub struct ApiThreadPreviewCursorInner {
    id: Uuid,
    provider_id: Option<String>,
    #[schema(value_type = String)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "String"))]
    owner_id: MacroUserIdStr<'static>,
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

#[derive(Debug, ToSchema, Serialize, Deserialize, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
#[dg(backward = Attachment)]
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

#[derive(Debug, ToSchema, Serialize, Deserialize, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
#[dg(backward = AttachmentMacro)]
pub struct ApiAttachmentMacro {
    db_id: Uuid,
    message_id: Uuid,
    item_id: Uuid,
    item_type: String,
}

#[derive(Debug, ToSchema, Serialize, Deserialize, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
#[dg(backward = Contact)]
pub struct ApiContact {
    id: Uuid,
    link_id: Uuid,
    name: Option<String>,
    email_address: Option<String>,
    sfs_photo_url: Option<String>,
}

#[derive(Debug, ToSchema, Serialize, Deserialize, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
#[dg(backward = Label)]
pub struct ApiLabel {
    id: Uuid,
    link_id: Uuid,
    provider_label_id: String,
    name: String,
    created_at: DateTime<Utc>,
    message_list_visibility: ApiMessageListVisibility,
    label_list_visibility: ApiLabelListVisibility,
    type_: ApiLabelType,
}

#[derive(Debug, ToSchema, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[dg(backward = MessageListVisibility)]
pub enum ApiMessageListVisibility {
    Show,
    Hide,
}

#[derive(Debug, ToSchema, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[dg(backward = LabelListVisibility)]
pub enum ApiLabelListVisibility {
    LabelShow,
    LabelShowIfUnread,
    LabelHide,
}

#[derive(Debug, ToSchema, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[dg(backward = LabelType)]
pub enum ApiLabelType {
    System,
    User,
}

#[derive(Debug, ToSchema, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[dg(backward = EmailThreadPreviewMetadata)]
pub struct APIEmailThreadPreviewMetadata {
    // if user has previously emailed this sender
    pub known_sender: bool,
    // if any email contains a <table> html tag
    pub tabular: bool,
    // if any email contains a calendar invite
    pub calendar_invite: bool,
    // if the sender is a generic email
    pub generic_sender: bool,
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
            items: items
                .into_iter()
                .map(ApiThreadPreviewCursor::mirror)
                .collect(),
            next_cursor,
        }
    }
}

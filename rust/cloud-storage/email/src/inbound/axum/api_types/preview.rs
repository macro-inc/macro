use chrono::{DateTime, Utc};
use doppleganger::{Doppleganger, Mirror};
use frecency::domain::models::AggregateFrecency;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::PaginatedOpaqueCursor;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::models::{
    Attachment, Contact, EmailThreadPreview, EnrichedEmailThreadPreview, Label,
};

use super::label::{ApiLabelListVisibility, ApiLabelType, ApiMessageListVisibility};

#[derive(Debug, ToSchema, Serialize, Deserialize, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
#[dg(backward = EnrichedEmailThreadPreview)]
struct ApiThreadPreviewCursor {
    #[serde(flatten)]
    thread: ApiThreadPreviewCursorInner,
    attachments: Vec<ApiAttachment>,
    #[dg(rename = "participants")]
    contacts: Vec<ApiContact>,
    labels: Vec<ApiLabel>,
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

    sort_ts: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
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

    created_at: DateTime<Utc>,
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

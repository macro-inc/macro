use crate::email::service::message::Message;
use crate::service::attachment::{Attachment, AttachmentMacro};
use crate::service::contact::Contact;
use crate::service::message::MessageWithBodyReplyless;
use chrono::{DateTime, Utc};
use models_pagination::{Identify, Query, SimpleSortMethod, SortOn};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_with::{DeserializeFromStr, SerializeDisplay};
use sqlx::FromRow;
use std::collections::HashMap;
use std::str::FromStr;
use strum::{Display, EnumString};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

/// Parameters for getting thread previews with cursor-based pagination.
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GetPreviewsCursorParams {
    /// Limit for pagination. Default is 20. Max is 500.
    pub limit: Option<u32>,
    /// Sort method. Options are viewed_at, created_at, updated_at, viewed_updated. Defaults to viewed_updated.
    pub sort_method: Option<ApiSortMethod>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ThreadSummary {
    pub provider_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ThreadList {
    pub threads: Vec<ThreadSummary>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Thread {
    pub db_id: Option<Uuid>,
    pub provider_id: Option<String>,
    pub link_id: Uuid,
    pub inbox_visible: bool,
    pub is_read: bool,
    // this field is only set w.r.t incoming messages (see is_inbound), for inbox thread ordering
    pub latest_inbound_message_ts: Option<DateTime<Utc>>,
    // this field is only set w.r.t outgoing messages (see is_outbound), for sent message thread ordering
    pub latest_outbound_message_ts: Option<DateTime<Utc>>,
    // latest message in the thread that isn't marked as spam, for all mail thread ordering
    pub latest_non_spam_message_ts: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub messages: Vec<Message>,
}

/// Thread object exposed to the FE in Get Threads Call
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct APIThread {
    pub db_id: Option<Uuid>,
    pub provider_id: Option<String>,
    pub link_id: Uuid,
    pub inbox_visible: bool,
    pub is_read: bool,
    // this field is only set w.r.t incoming messages (see is_inbound), for inbox thread ordering
    pub latest_inbound_message_ts: Option<DateTime<Utc>>,
    // this field is only set w.r.t outgoing messages (see is_outbound), for sent message thread ordering
    pub latest_outbound_message_ts: Option<DateTime<Utc>>,
    // latest message in the thread that isn't marked as spam, for all mail thread ordering
    pub latest_non_spam_message_ts: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub messages: Vec<MessageWithBodyReplyless>,
}

impl APIThread {
    pub fn from_thread_with_messages(
        thread: Thread,
        messages: Vec<MessageWithBodyReplyless>,
    ) -> Self {
        Self {
            db_id: thread.db_id,
            provider_id: thread.provider_id,
            link_id: thread.link_id,
            inbox_visible: thread.inbox_visible,
            is_read: thread.is_read,
            latest_inbound_message_ts: thread.latest_inbound_message_ts,
            latest_outbound_message_ts: thread.latest_outbound_message_ts,
            latest_non_spam_message_ts: thread.latest_non_spam_message_ts,
            created_at: thread.created_at,
            updated_at: thread.updated_at,
            messages,
        }
    }
}

/// thread summary returned in preview endpoint
#[derive(FromRow, Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ThreadPreview {
    pub thread_id: Uuid,
    pub provider_id: Option<String>,
    pub inbox_visible: bool,
    pub is_read: bool,
    pub is_draft: bool,
    pub sort_ts: DateTime<Utc>,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub sender_email: Option<String>,
    pub sender_name: Option<String>,
    pub attachments: Vec<Attachment>,
}

/// thread summary returned in preview cursor endpoint
#[derive(FromRow, Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPreviewCursor {
    #[schemars(with = "String")]
    pub id: Uuid,
    pub provider_id: Option<String>,
    pub owner_id: String,
    pub inbox_visible: bool,
    pub is_read: bool,
    pub is_draft: bool,
    pub is_important: bool,
    pub name: Option<String>,
    pub snippet: Option<String>,
    pub sender_email: Option<String>,
    pub sender_name: Option<String>,
    pub sender_photo_url: Option<String>,
    pub attachments: Vec<Attachment>,
    pub attachments_macro: Vec<AttachmentMacro>,
    pub participants: Vec<Contact>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[schemars(with = "i64")]
    pub sort_ts: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[schemars(with = "i64")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[schemars(with = "i64")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[schema(value_type = i64, nullable = true)]
    #[schemars(with = "Option<i64>")]
    pub viewed_at: Option<DateTime<Utc>>,
}

impl ThreadPreviewCursor {
    fn timestamp_for_sort_method(&self, sort_method: SimpleSortMethod) -> DateTime<Utc> {
        match sort_method {
            SimpleSortMethod::ViewedAt => self.viewed_at.unwrap_or(DateTime::UNIX_EPOCH),
            SimpleSortMethod::UpdatedAt => self.updated_at,
            SimpleSortMethod::CreatedAt => self.created_at,
            SimpleSortMethod::ViewedUpdated => self.viewed_at.unwrap_or(self.updated_at),
        }
    }
}

impl SortOn<SimpleSortMethod> for ThreadPreviewCursor {
    fn sort_on(
        sort: SimpleSortMethod,
    ) -> impl FnOnce(&Self) -> models_pagination::CursorVal<SimpleSortMethod> {
        move |v| {
            let last_val = v.timestamp_for_sort_method(sort);
            models_pagination::CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct PaginatedThreadCursor {
    pub items: Vec<ThreadPreviewCursor>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct GetPreviewsCursorResponse {
    /// the thread, with messages inside
    pub previews: PaginatedThreadCursor,
}

impl From<crate::email::db::thread::ThreadPreview> for ThreadPreview {
    fn from(db_preview: crate::email::db::thread::ThreadPreview) -> Self {
        Self {
            thread_id: db_preview.thread_id,
            provider_id: db_preview.provider_id,
            inbox_visible: db_preview.inbox_visible,
            is_read: db_preview.is_read,
            is_draft: db_preview.is_draft,
            sort_ts: db_preview.sort_ts,
            subject: db_preview.subject,
            snippet: db_preview.snippet,
            sender_email: db_preview.sender_email,
            sender_name: db_preview.sender_name,
            attachments: Vec::new(),
        }
    }
}

// Assuming the existence of a `db::thread::ThreadPreview` struct that was updated
// to have `id` and `name` fields, as per the previous request.
impl ThreadPreviewCursor {
    pub fn new_from(
        db_preview: crate::email::db::thread::ThreadPreviewCursor,
        owner_id: String,
    ) -> Self {
        Self {
            id: db_preview.id,
            provider_id: db_preview.provider_id,
            owner_id,
            inbox_visible: db_preview.inbox_visible,
            is_read: db_preview.is_read,
            // The `is_draft` field needs to be present on the db struct.
            is_draft: db_preview.is_draft,
            is_important: db_preview.is_important,
            sort_ts: db_preview.sort_ts,
            name: db_preview.name,
            snippet: db_preview.snippet,
            sender_email: db_preview.sender_email,
            sender_name: db_preview.sender_name,
            sender_photo_url: db_preview.sender_photo_url,
            attachments: Vec::new(),
            attachments_macro: Vec::new(),
            participants: Vec::new(),
            viewed_at: db_preview.viewed_at,
            created_at: db_preview.created_at,
            updated_at: db_preview.updated_at,
        }
    }
}

impl Identify for ThreadPreview {
    type Id = Uuid;

    fn id(&self) -> Uuid {
        self.thread_id
    }
}

impl Identify for ThreadPreviewCursor {
    type Id = Uuid;
    fn id(&self) -> Uuid {
        self.id
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadUserInfo {
    pub thread_id: Uuid,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct ListThreadsPayload {
    pub next_page_token: Option<String>,
}

/// A mapping from provider IDs to thread IDs
/// Keys: provider_id (String) - The external provider's identifier for the thread
/// Values: thread_id (Uuid) - The internal database UUID for the thread
pub type ThreadProviderMap = HashMap<String, Uuid>;

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    EnumString,
    Display,
    SerializeDisplay,
    DeserializeFromStr,
    JsonSchema,
    ToSchema,
)]
#[strum(serialize_all = "lowercase", ascii_case_insensitive)]
#[schema(rename_all = "lowercase")]
pub enum PreviewViewStandardLabel {
    Inbox,
    Sent,
    Drafts,
    Starred,
    All,
    Important,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, SerializeDisplay, DeserializeFromStr)]
pub enum PreviewView {
    StandardLabel(PreviewViewStandardLabel),
    UserLabel(String),
}

impl utoipa::ToSchema for PreviewView {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("PreviewView")
    }
}

impl utoipa::PartialSchema for PreviewView {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::schema::Schema::OneOf(
            utoipa::openapi::OneOfBuilder::new()
                .item(PreviewViewStandardLabel::schema())
                .item(
                    utoipa::openapi::schema::ObjectBuilder::new()
                        .schema_type(utoipa::openapi::schema::Type::String)
                        .format(Some(utoipa::openapi::schema::SchemaFormat::Custom(
                            "user:<label>".to_string(),
                        )))
                        .build(),
                )
                .description(Some("View type. Supported values include standard labels and a custom user label user:<label>".to_string()))
                .build(),
        )
        .into()
    }
}

impl std::fmt::Display for PreviewView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PreviewView::StandardLabel(label) => write!(f, "{}", label),
            PreviewView::UserLabel(label) => write!(f, "user:{}", label),
        }
    }
}

impl FromStr for PreviewView {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match PreviewViewStandardLabel::from_str(s) {
            Ok(label) => Ok(PreviewView::StandardLabel(label)),
            Err(_) => match s.to_lowercase().as_str() {
                s if s.starts_with("user:") => Ok(PreviewView::UserLabel(s[5..].to_string())),
                _ => Err(format!("Unknown preview view: {}", s)),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserThreadsPage {
    pub threads: Vec<ThreadUserInfo>,
    pub is_complete: bool,
}

#[derive(Debug, Clone)]
pub struct UserThreadIds {
    pub macro_user_id: String,
    pub thread_ids: Vec<Uuid>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetThreadOwnerResponse {
    pub user_id: String,
}

#[derive(Debug)]
pub struct PreviewCursorQuery {
    pub view: PreviewView,
    pub link_id: Uuid,
    pub limit: u32,
    pub query: Query<Uuid, SimpleSortMethod, ()>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preview_view_display() {
        assert_eq!(
            PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox).to_string(),
            "inbox"
        );
        assert_eq!(
            PreviewView::StandardLabel(PreviewViewStandardLabel::Sent).to_string(),
            "sent"
        );
        assert_eq!(
            PreviewView::UserLabel("mytag".to_string()).to_string(),
            "user:mytag"
        );
    }

    #[test]
    fn test_preview_view_from_str() {
        assert_eq!(
            PreviewView::from_str("inbox").unwrap(),
            PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
        );
        assert_eq!(
            PreviewView::from_str("SENT").unwrap(),
            PreviewView::StandardLabel(PreviewViewStandardLabel::Sent)
        );
        assert_eq!(
            PreviewView::from_str("user:mytag").unwrap(),
            PreviewView::UserLabel("mytag".to_string())
        );
        assert!(PreviewView::from_str("invalid").is_err());
    }

    #[test]
    fn test_preview_view_serialization() {
        assert_eq!(
            serde_json::to_string(&PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox))
                .unwrap(),
            "\"inbox\""
        );
        assert_eq!(
            serde_json::to_string(&PreviewView::StandardLabel(PreviewViewStandardLabel::Sent))
                .unwrap(),
            "\"sent\""
        );
        assert_eq!(
            serde_json::to_string(&PreviewView::UserLabel("mytag".to_string())).unwrap(),
            "\"user:mytag\""
        );
    }

    #[test]
    fn test_preview_view_deserialization() {
        assert_eq!(
            serde_json::from_str::<PreviewView>("\"inbox\"").unwrap(),
            PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
        );
        assert_eq!(
            serde_json::from_str::<PreviewView>("\"SENT\"").unwrap(),
            PreviewView::StandardLabel(PreviewViewStandardLabel::Sent)
        );
        assert_eq!(
            serde_json::from_str::<PreviewView>("\"user:mytag\"").unwrap(),
            PreviewView::UserLabel("mytag".to_string())
        );
        assert!(serde_json::from_str::<PreviewView>("\"invalid\"").is_err());
    }
}

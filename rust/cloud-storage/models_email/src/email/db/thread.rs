use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: Uuid,
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
}

/// thread summary returned in preview endpoint
#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
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
}
/// thread summary returned in preview cursor endpoint
#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct ThreadPreviewCursor {
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
}

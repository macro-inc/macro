use chrono::{DateTime, Utc};
use entity_access::domain::models::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::models::Thread;

use super::message::ApiMessage;

/// Query parameters for the get-thread endpoint.
#[derive(Debug, Deserialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct GetThreadParams {
    /// Offset for message pagination. Default is 0.
    pub offset: Option<i64>,
    /// Maximum number of messages to return. Default is 5, max is 100.
    pub limit: Option<i64>,
}

/// Response body for the get-thread endpoint.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct GetThreadResponse {
    pub thread: ApiThread,
}

/// API representation of a fully assembled email thread.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiThread {
    pub db_id: Uuid,
    pub provider_id: Option<String>,
    pub link_id: Uuid,
    pub inbox_visible: bool,
    pub is_read: bool,
    pub access_level: AccessLevel,
    pub latest_inbound_message_ts: Option<DateTime<Utc>>,
    pub latest_outbound_message_ts: Option<DateTime<Utc>>,
    pub latest_non_spam_message_ts: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub messages: Vec<ApiMessage>,
}

impl ApiThread {
    pub fn from_thread(t: Thread, access_level: AccessLevel) -> Self {
        ApiThread {
            db_id: t.row.db_id,
            provider_id: t.row.provider_id,
            link_id: t.row.link_id,
            inbox_visible: t.row.inbox_visible,
            is_read: t.row.is_read,
            access_level,
            latest_inbound_message_ts: t.row.latest_inbound_message_ts,
            latest_outbound_message_ts: t.row.latest_outbound_message_ts,
            latest_non_spam_message_ts: t.row.latest_non_spam_message_ts,
            created_at: t.row.created_at,
            updated_at: t.row.updated_at,
            messages: t.messages.into_iter().map(ApiMessage::from).collect(),
        }
    }
}

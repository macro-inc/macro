use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailHistory {
    pub link_id: Uuid,
    pub history_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// a curated list of changes we need to make to a user's inbox, based on fetching the inbox history
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxChanges {
    // messages we need to upsert because a) they are new or b) a change happened but we don't know what change (thanks Gmail)
    pub message_ids_to_upsert: HashSet<String>,
    // messages we need to delete because the user perma deleted them
    pub message_ids_to_delete: HashSet<String>,
    // messages we need to update the labels for
    pub labels_to_update: HashSet<String>,
    // the current history_id for the user at time of fetching the history.
    pub current_history_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchResponse {
    pub history_id: String,
    pub expiration: String,
}

/// Database representation of Gmail history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailHistoryDb {
    pub link_id: Uuid,
    pub history_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<GmailHistory> for GmailHistoryDb {
    fn from(service_history: GmailHistory) -> Self {
        Self {
            link_id: service_history.link_id,
            history_id: service_history.history_id,
            created_at: service_history.created_at,
            updated_at: service_history.updated_at,
        }
    }
}

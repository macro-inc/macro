use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// SyncTokens stores Google API sync tokens used for incremental updates during contact syncing.
/// When making subsequent requests to Google's People API, these tokens allow fetching only
/// changes that occurred since the last sync.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SyncTokens {
    pub link_id: Uuid,
    pub contacts_sync_token: Option<String>,
    pub other_contacts_sync_token: Option<String>,
}

impl From<crate::email::db::sync_token::SyncTokens> for SyncTokens {
    fn from(db_sync_tokens: crate::email::db::sync_token::SyncTokens) -> Self {
        Self {
            link_id: db_sync_tokens.link_id,
            contacts_sync_token: db_sync_tokens.contacts_sync_token,
            other_contacts_sync_token: db_sync_tokens.other_contacts_sync_token,
        }
    }
}

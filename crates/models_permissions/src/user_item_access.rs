use crate::share_permission::access_level::AccessLevel;
use sqlx::types::Uuid;
use sqlx::types::chrono::{DateTime, Utc};

/// Represents a user's access to a specific item (document, project, etc.)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserItemAccess {
    /// Unique identifier for this access record
    pub id: Uuid,

    /// The ID of the user who has access
    pub user_id: String,

    /// The ID of the item being accessed
    pub item_id: String,

    /// The type of item (e.g., "document", "project")
    pub item_type: String,

    /// The level of access granted
    pub access_level: AccessLevel,

    /// If access was granted via a channel, this is the channel's ID
    pub granted_from_channel_id: Option<Uuid>,

    /// When this access record was created
    pub created_at: DateTime<Utc>,

    /// When this access record was last updated
    pub updated_at: DateTime<Utc>,
}

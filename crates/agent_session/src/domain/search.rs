//! Metadata needed to present a searchable session without loading its ACP log.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// Current metadata for an agent-session search result.
#[derive(Debug, Clone)]
pub struct AgentSessionSearchMetadata {
    /// Session identity.
    pub id: Uuid,
    /// User-facing name.
    pub name: String,
    /// Session owner.
    pub owner_id: MacroUserIdStr<'static>,
    /// Agent persona identity.
    pub bot_id: Uuid,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last metadata update.
    pub updated_at: DateTime<Utc>,
}

use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An agent session as displayed in Soup.
///
/// Mirrors [`crate::chat::SoupChat`]: an agent session is the coding-agent
/// counterpart of a chat, so it carries the same identity, ownership, and
/// recency fields plus the session's last known status.
#[derive(Serialize, Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupAgentSession<T = ()> {
    /// The agent session uuid
    pub id: Uuid,

    /// The user-facing name of the session
    pub name: String,

    /// Who the session belongs to
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,

    /// The bot running this session
    pub bot_id: Uuid,

    /// The channel thread the session was opened from, when any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<Uuid>,

    /// The session's last known status.
    ///
    /// `no_messages` until the first system event arrives, `disconnected` if
    /// the connection dropped without a clean close, otherwise the wire name
    /// of the most recent system event (for example `session/end`).
    pub status: String,

    /// The time the session was created
    pub created_at: chrono::DateTime<Utc>,

    /// The time the session was last modified
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the session was last viewed by the requesting user
    pub viewed_at: Option<chrono::DateTime<Utc>>,

    /// Extra fields passed from above
    #[serde(flatten)]
    pub extra: T,
}

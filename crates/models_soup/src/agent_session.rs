use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The coarse status of an agent session, mirroring the
/// `agent_session.status` column.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SoupAgentSessionStatusKind {
    /// No status updates received yet.
    NoMessages,
    /// The runtime reported an event; see `status_event_name` for which.
    Event,
    /// The session disconnected without sending a closed event.
    Disconnected,
}

/// An agent coding session as displayed in Soup.
///
/// Unlike tasks (documents with a sub type), agent sessions are their own
/// Soup entity: they live in their own table and carry display state — status,
/// model, harness, attention badges — no document has.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupAgentSession<T = ()> {
    /// The agent session id.
    pub id: Uuid,
    /// The user who created and owns the session.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,
    /// Session title the runtime reported, when it has. Clients fall back to
    /// the harness name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Model slug the session runs on.
    pub model: String,
    /// Harness slug serving the session.
    pub harness: String,
    /// Repository the session works against, when one was stated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    /// Coarse session status.
    pub status_kind: SoupAgentSessionStatusKind,
    /// The latest runtime event's wire name (`"acp_ready"`, `"booting"`, ...),
    /// present exactly when `status_kind` is `event`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_event_name: Option<String>,
    /// How many permission requests are awaiting an answer.
    pub pending_permission_count: i32,
    /// The pull request the session produced, when one was detected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
    /// The channel the session was spawned from, when it was.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_channel_id: Option<Uuid>,
    /// When the session was created.
    pub created_at: DateTime<Utc>,
    /// When the session last changed. This is what Soup sorts sessions on.
    pub modified_at: DateTime<Utc>,
    /// Extra fields passed from above
    #[serde(flatten)]
    pub extra: T,
}

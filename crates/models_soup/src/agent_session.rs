use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The kind of status an agent session row carries, mirroring
/// `agent_session::domain::model::SessionStatus` on the wire.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SoupAgentSessionStatusKind {
    /// No status updates received yet.
    NoMessages,
    /// The latest runtime event names the session's state — see
    /// [`SoupAgentSession::status_event_name`].
    Event,
    /// The session disconnected without a clean close.
    Disconnected,
}

/// An agent coding session as displayed in Soup.
///
/// Sessions carry no properties; access resolves through `entity_access`
/// (the owner, plus the channel the bot was mentioned in).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupAgentSession<T = ()> {
    /// The agent session id.
    pub id: Uuid,
    /// The Macro user who owns the session.
    pub owner_id: String,
    /// The title the agent reported for the session, when one exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Model slug the session runs on.
    pub model: String,
    /// Harness slug the session runs.
    pub harness: String,
    /// Repository the session works against, when one was stated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    /// The kind of status the session is in.
    pub status_kind: SoupAgentSessionStatusKind,
    /// The wire name of the latest runtime event, when `status_kind` is
    /// `event` — e.g. `booting`, `acp_ready`, `worktree_ready`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_event_name: Option<String>,
    /// How many permission requests are outstanding. Greater than zero means
    /// the session is waiting on a person.
    pub pending_permission_count: i32,
    /// The pull request the session produced, when one is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
    /// The channel of the thread the session was opened from, when it was
    /// opened by a mention.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_channel_id: Option<Uuid>,
    /// When the session was created.
    pub created_at: DateTime<Utc>,
    /// When the session was last modified. Soup sorts sessions on this.
    pub modified_at: DateTime<Utc>,
    /// Extra fields passed from above.
    #[serde(flatten)]
    pub extra: T,
}

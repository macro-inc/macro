use chrono::Utc;
use model_owner::Owner;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Last synchronized state of a session's linked GitHub pull request.
#[derive(Serialize, Clone, Copy, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum AgentPullRequestState {
    /// The pull request accepts changes.
    Open,
    /// The pull request is still a draft.
    Draft,
    /// The pull request was closed without merging.
    Closed,
    /// The pull request was merged.
    Merged,
}

/// An agent session as displayed in Soup.
///
/// Includes the persisted runtime and repository metadata needed to render
/// coding and non-coding sessions without fetching each session separately.
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
    pub owner_id: Owner,

    /// The bot running this session
    pub bot_id: Uuid,

    /// The runtime snapshotted when the session was created.
    pub harness: String,

    /// The repository the session works with, when one was selected.
    pub repo_url: Option<String>,

    /// The starting branch selected for this session, not its current branch.
    pub repo_branch: Option<String>,

    /// The persisted pull request associated with the session.
    pub pull_request_url: Option<String>,

    /// Last captured working branch, when the runtime has reported one.
    pub working_branch: Option<String>,

    /// Last synchronized state of the linked pull request, when visible.
    pub pull_request_state: Option<AgentPullRequestState>,

    /// The linked pull request's Macro entity, when visible to the viewer.
    pub pull_request_id: Option<Uuid>,

    /// Last persisted fold turn state. Absent until an older session next runs.
    pub turn_state: Option<String>,

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

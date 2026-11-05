//! Wire contract of the internal API, shared by the router and the client.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Create (or re-key) the agent's repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRepoRequest {
    /// The agent's Macro user.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// The team whose admins may read the repo.
    pub team_id: Uuid,
}

/// The repo's credential, returned once.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedRepoResponse {
    /// The agent's Macro user.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// Repo token: the HTTP Basic password for clone and push.
    pub token: String,
    /// Smart-HTTP clone URL.
    pub clone_url: String,
}

impl std::fmt::Debug for CreatedRepoResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CreatedRepoResponse")
            .field("agent_user_id", &self.agent_user_id)
            .field("clone_url", &self.clone_url)
            .finish_non_exhaustive()
    }
}

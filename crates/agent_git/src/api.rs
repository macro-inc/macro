//! Wire contract of the internal API, shared by the router and the client.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::RepoToken;
use crate::domain::template::PersonaSeed;

/// Create (or re-key) the agent's repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRepoRequest {
    /// The agent's Macro user.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// The team whose admins may read the repo.
    pub team_id: Uuid,
    /// Who the agent is; written into the repo's charter.
    pub seed: PersonaSeed,
}

/// Recover a missing repo with the credential saved in its computer persona.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureRepoRequest {
    /// Original creation inputs.
    #[serde(flatten)]
    pub repo: CreateRepoRequest,
    /// Original token; never replaces a live token.
    pub token: RepoToken,
}

impl std::fmt::Debug for EnsureRepoRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("EnsureRepoRequest")
            .finish_non_exhaustive()
    }
}

/// The repo's credential, returned once.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedRepoResponse {
    /// The agent's Macro user.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// Repo token: the HTTP Basic password for clone and push.
    pub token: RepoToken,
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

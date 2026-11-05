//! Ports of the agent git domain.

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    AgentGitError, AgentRepo, AuthorizedRepo, CreatedRepo, GitCredential, GitRequest, GitResponse,
    RepoTokenHash,
};
use crate::domain::template::{PersonaSeed, RenderedFile};

/// Repo rows (`agent_repos`).
pub trait RepoRepository: Send + Sync + 'static {
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The agent's repo row.
    fn find_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<AgentRepo>, Self::Err>> + Send;

    /// Insert the row, or replace its token when it exists for the same team.
    /// Returns `false` (and changes nothing) when it exists for another team.
    fn upsert_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        token_hash: &RepoTokenHash,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Record an accepted push and the size measured before it.
    fn record_push(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        size_bytes: u64,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the row; missing rows are fine.
    fn delete_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Bare repos on disk.
pub trait RepoStore: Send + Sync + 'static {
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Create the bare repo with `files` as its initial commit. A repo that
    /// already exists is left as is.
    fn create_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        files: &[RenderedFile],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the bare repo; a missing repo is fine.
    fn delete_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Bytes the bare repo occupies.
    fn repo_size_bytes(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;
}

/// Team roles.
pub trait TeamAdmins: Send + Sync + 'static {
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Whether the user is an admin or owner of the team.
    fn is_team_admin(
        &self,
        team_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Per-repo push budget.
pub trait PushRateLimiter: Send + Sync + 'static {
    /// Take one push from the repo's budget; `false` when it is spent.
    fn try_acquire_push(&self, agent_user_id: &MacroUserIdStr<'_>) -> bool;
}

/// Serves smart-HTTP requests against a bare repo.
pub trait GitBackend: Send + Sync + 'static {
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Run the request against the authorized repo.
    fn serve(
        &self,
        repo: &AuthorizedRepo,
        request: GitRequest,
    ) -> impl Future<Output = Result<GitResponse, Self::Err>> + Send;
}

/// The use cases inbound adapters drive.
pub trait AgentGitService: Send + Sync + 'static {
    /// Create the agent's repo and mint its token. Repeating it for the same
    /// team keeps the repo and replaces the token, so a retry after a lost
    /// response still ends with one working token.
    fn create_repo(
        &self,
        agent_user_id: MacroUserIdStr<'static>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> impl Future<Output = Result<CreatedRepo, AgentGitError>> + Send;

    /// Delete the agent's repo and its row. Idempotent.
    fn delete_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), AgentGitError>> + Send;

    /// Authorize the credential for the request's endpoint, enforce the
    /// limits, and serve it.
    fn serve_git(
        &self,
        credential: GitCredential,
        agent_user_id: &MacroUserIdStr<'_>,
        request: GitRequest,
    ) -> impl Future<Output = Result<GitResponse, AgentGitError>> + Send;
}

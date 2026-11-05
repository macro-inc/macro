//! The agent git domain service.

use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    AgentGitError, AuthorizedRepo, CreatedRepo, GitAccess, GitBody, GitCredential, GitEndpoint,
    GitRequest, GitResponse, GitService, RepoLimits, RepoToken,
};
use crate::domain::ports::{
    AgentGitService, GitBackend, PushRateLimiter, RepoRepository, RepoStore, TeamAdmins,
};
use crate::domain::template::{PersonaSeed, WorkspaceTemplate};

/// The adapters [`AgentGitServiceImpl`] runs on.
pub struct AgentGitAdapters<Repos, Store, Admins, Limiter, Backend> {
    /// Repo rows.
    pub repos: Repos,
    /// Bare repos on disk.
    pub store: Store,
    /// Team roles.
    pub admins: Admins,
    /// Push budget.
    pub limiter: Limiter,
    /// Smart-HTTP backend.
    pub backend: Backend,
}

/// Implements [`AgentGitService`].
pub struct AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend> {
    adapters: AgentGitAdapters<Repos, Store, Admins, Limiter, Backend>,
    limits: RepoLimits,
    template: WorkspaceTemplate,
    // The service runs one task. Serialize management across the filesystem
    // and database so recovery cannot publish a repo after deletion finishes.
    mutations: tokio::sync::Mutex<()>,
}

impl<Repos, Store, Admins, Limiter, Backend>
    AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend>
{
    /// Build the service.
    pub fn new(
        adapters: AgentGitAdapters<Repos, Store, Admins, Limiter, Backend>,
        limits: RepoLimits,
        template: WorkspaceTemplate,
    ) -> Self {
        Self {
            adapters,
            limits,
            template,
            mutations: tokio::sync::Mutex::new(()),
        }
    }
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> AgentGitError {
    AgentGitError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Fail the body once it carries more than `limit` bytes, so a single push
/// cannot overshoot the size cap.
fn limit_body(body: GitBody, limit: u64) -> GitBody {
    let mut received: u64 = 0;

    Box::pin(body.map(move |chunk| {
        let chunk = chunk?;
        received = received.saturating_add(chunk.len() as u64);

        if received > limit {
            return Err(std::io::Error::other("push exceeds the repo size limit"));
        }

        Ok(chunk)
    }))
}

impl<Repos, Store, Admins, Limiter, Backend> AgentGitService
    for AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend>
where
    Repos: RepoRepository,
    Store: RepoStore,
    Admins: TeamAdmins,
    Limiter: PushRateLimiter,
    Backend: GitBackend,
{
    async fn create_repo(
        &self,
        agent_user_id: MacroUserIdStr<'static>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> Result<CreatedRepo, AgentGitError> {
        let _mutation = self.mutations.lock().await;
        let existing = self
            .adapters
            .repos
            .find_repo(&agent_user_id)
            .await
            .map_err(internal)?;

        if existing.is_some_and(|repo| repo.team_id != team_id) {
            return Err(AgentGitError::TeamMismatch);
        }

        self.adapters
            .store
            .create_repo(
                &agent_user_id,
                &self.template.render(seed).map_err(internal)?,
            )
            .await
            .map_err(internal)?;

        let token = RepoToken::generate();
        let stored = self
            .adapters
            .repos
            .upsert_repo(&agent_user_id, team_id, &token.hash())
            .await
            .map_err(internal)?;

        if !stored {
            return Err(AgentGitError::TeamMismatch);
        }

        Ok(CreatedRepo {
            agent_user_id,
            token,
        })
    }

    #[cfg_attr(any(feature = "inbound", feature = "outbound"), tracing::instrument(skip_all, fields(%agent_user_id, %team_id), err))]
    async fn ensure_repo(
        &self,
        agent_user_id: MacroUserIdStr<'static>,
        team_id: Uuid,
        seed: &PersonaSeed,
        token: RepoToken,
    ) -> Result<CreatedRepo, AgentGitError> {
        let _mutation = self.mutations.lock().await;
        let token = RepoToken::recovery(token.expose().to_owned())?;
        // The database uniqueness constraint arbitrates concurrent recovery.
        // Never use upsert_repo here: it intentionally rotates live tokens.
        self.adapters
            .repos
            .insert_repo_if_missing(&agent_user_id, team_id, &token.hash())
            .await
            .map_err(internal)?;
        let repo = self
            .adapters
            .repos
            .find_repo(&agent_user_id)
            .await
            .map_err(internal)?
            .ok_or(AgentGitError::NotFound)?;
        if repo.team_id != team_id {
            return Err(AgentGitError::TeamMismatch);
        }
        if !repo.token_hash.matches(&token.hash()) {
            return Err(AgentGitError::InvalidToken);
        }
        self.adapters
            .store
            .create_repo(
                &agent_user_id,
                &self.template.render(seed).map_err(internal)?,
            )
            .await
            .map_err(internal)?;
        Ok(CreatedRepo {
            agent_user_id,
            token,
        })
    }

    async fn delete_repo(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<(), AgentGitError> {
        let _mutation = self.mutations.lock().await;
        // Directory first: a failure leaves the row, so a retry finds the repo.
        self.adapters
            .store
            .delete_repo(agent_user_id)
            .await
            .map_err(internal)?;

        self.adapters
            .repos
            .delete_repo(agent_user_id)
            .await
            .map_err(internal)
    }

    async fn serve_git(
        &self,
        credential: GitCredential,
        agent_user_id: &MacroUserIdStr<'_>,
        mut request: GitRequest,
    ) -> Result<GitResponse, AgentGitError> {
        let repo = self
            .adapters
            .repos
            .find_repo(agent_user_id)
            .await
            .map_err(internal)?
            .ok_or(AgentGitError::NotFound)?;

        let access = request.endpoint.access();

        match credential {
            GitCredential::RepoToken(token) => {
                if !repo.token_hash.matches(&token.hash()) {
                    return Err(AgentGitError::InvalidToken);
                }
            }
            GitCredential::User(user_id) => {
                // Admins read; only the agent's token pushes.
                if access == GitAccess::Push {
                    return Err(AgentGitError::Forbidden(access));
                }

                let is_admin = self
                    .adapters
                    .admins
                    .is_team_admin(repo.team_id, &user_id)
                    .await
                    .map_err(internal)?;

                if !is_admin {
                    return Err(AgentGitError::Forbidden(access));
                }
            }
        }

        if access == GitAccess::Push {
            let size_bytes = self
                .adapters
                .store
                .repo_size_bytes(agent_user_id)
                .await
                .map_err(internal)?;
            let limit_bytes = self.limits.max_repo_size_bytes;

            if size_bytes >= limit_bytes {
                return Err(AgentGitError::RepoTooLarge {
                    size_bytes,
                    limit_bytes,
                });
            }

            if request.endpoint == GitEndpoint::Rpc(GitService::ReceivePack) {
                if !self.adapters.limiter.try_acquire_push(agent_user_id) {
                    return Err(AgentGitError::PushRateLimited);
                }

                self.adapters
                    .repos
                    .record_push(agent_user_id, size_bytes)
                    .await
                    .map_err(internal)?;

                request.body = limit_body(request.body, limit_bytes - size_bytes);
            }
        }

        self.adapters
            .backend
            .serve(&AuthorizedRepo::new(repo.agent_user_id, access), request)
            .await
            .map_err(internal)
    }
}

#[cfg(test)]
mod test;

//! The agent git domain service.

use feature_flags::FeatureFlags;
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
use crate::domain::template::{PersonaSeed, RenderError, WorkspaceTemplate};
use crate::domain::voice::{VOICE_PATH, VoiceConfig};

/// The adapters [`AgentGitServiceImpl`] runs on.
pub struct AgentGitAdapters<Repos, Store, Admins, Limiter, Backend, Flags> {
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
    /// The agent teammates rollout, checked for the repo's agent on every
    /// clone and push. None, or a failed load, refuses (fail closed).
    pub flags: Option<Flags>,
}

/// Implements [`AgentGitService`].
pub struct AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend, Flags> {
    adapters: AgentGitAdapters<Repos, Store, Admins, Limiter, Backend, Flags>,
    limits: RepoLimits,
    template: WorkspaceTemplate,
}

impl<Repos, Store, Admins, Limiter, Backend, Flags>
    AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend, Flags>
{
    /// Build the service.
    pub fn new(
        adapters: AgentGitAdapters<Repos, Store, Admins, Limiter, Backend, Flags>,
        limits: RepoLimits,
        template: WorkspaceTemplate,
    ) -> Self {
        Self {
            adapters,
            limits,
            template,
        }
    }
}

/// Message of the commit a voice change makes.
const VOICE_COMMIT_MESSAGE: &str = "Set call voice";

impl<Repos: RepoRepository, Store, Admins, Limiter, Backend, Flags>
    AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend, Flags>
{
    /// The agent's repo row, which must belong to `team_id`.
    async fn team_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
    ) -> Result<(), AgentGitError> {
        let repo = self
            .adapters
            .repos
            .find_repo(agent_user_id)
            .await
            .map_err(internal)?
            .ok_or(AgentGitError::NotFound)?;

        if repo.team_id != team_id {
            return Err(AgentGitError::TeamMismatch);
        }

        Ok(())
    }
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> AgentGitError {
    AgentGitError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// A seed without a creator is the caller's mistake; other render failures
/// are the template's.
fn render_error(error: RenderError) -> AgentGitError {
    match error {
        RenderError::MissingCreator => AgentGitError::MissingCreator,
        other => internal(other),
    }
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

impl<Repos, Store, Admins, Limiter, Backend, Flags: FeatureFlags>
    AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend, Flags>
{
    async fn rollout_on(&self, agent_user_id: &MacroUserIdStr<'_>) -> bool {
        let Some(flags) = &self.adapters.flags else {
            return false;
        };
        let loaded = flags.load(agent_user_id).await;
        #[cfg(any(feature = "inbound", feature = "outbound"))]
        if let Err(error) = &loaded {
            tracing::warn!(error = ?error, "could not load feature flags; the agent's repo stays closed");
        }
        loaded.is_ok_and(|snapshot| snapshot.is_enabled(agent_credentials::AGENT_TEAMMATES_FLAG))
    }
}

impl<Repos, Store, Admins, Limiter, Backend, Flags> AgentGitService
    for AgentGitServiceImpl<Repos, Store, Admins, Limiter, Backend, Flags>
where
    Repos: RepoRepository,
    Store: RepoStore,
    Admins: TeamAdmins,
    Limiter: PushRateLimiter,
    Backend: GitBackend,
    Flags: FeatureFlags + 'static,
{
    async fn create_repo(
        &self,
        agent_user_id: MacroUserIdStr<'static>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> Result<CreatedRepo, AgentGitError> {
        // Every replica serializes management of a repo, across the
        // filesystem and database, so recovery cannot publish a repo after
        // deletion finishes.
        let _lock = self
            .adapters
            .repos
            .lock_repo(&agent_user_id)
            .await
            .map_err(internal)?;
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
                &self
                    .template
                    .render(&agent_user_id, seed)
                    .map_err(render_error)?,
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

    #[cfg_attr(any(feature = "inbound", feature = "outbound"), tracing::instrument(skip_all, fields(agent_user_id = %agent_credentials::telemetry_id(agent_user_id.as_ref()), %team_id), err))]
    async fn ensure_repo(
        &self,
        agent_user_id: MacroUserIdStr<'static>,
        team_id: Uuid,
        seed: &PersonaSeed,
        token: RepoToken,
    ) -> Result<CreatedRepo, AgentGitError> {
        let _lock = self
            .adapters
            .repos
            .lock_repo(&agent_user_id)
            .await
            .map_err(internal)?;
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
                &self
                    .template
                    .render(&agent_user_id, seed)
                    .map_err(render_error)?,
            )
            .await
            .map_err(internal)?;
        Ok(CreatedRepo {
            agent_user_id,
            token,
        })
    }

    async fn delete_repo(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<(), AgentGitError> {
        let _lock = self
            .adapters
            .repos
            .lock_repo(agent_user_id)
            .await
            .map_err(internal)?;
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

    #[cfg_attr(any(feature = "inbound", feature = "outbound"), tracing::instrument(skip_all, fields(agent_user_id = %agent_credentials::telemetry_id(agent_user_id.as_ref()), %team_id), err))]
    async fn voice(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
    ) -> Result<VoiceConfig, AgentGitError> {
        self.team_repo(agent_user_id, team_id).await?;
        let contents = self
            .adapters
            .store
            .read_file(agent_user_id, VOICE_PATH)
            .await
            .map_err(internal)?
            .ok_or(AgentGitError::NoVoice)?;

        // The agent owns its repo and may have written anything there.
        serde_json::from_slice(&contents).map_err(|_| AgentGitError::NoVoice)
    }

    #[cfg_attr(any(feature = "inbound", feature = "outbound"), tracing::instrument(skip_all, fields(agent_user_id = %agent_credentials::telemetry_id(agent_user_id.as_ref()), %team_id, voice = %voice.model), err))]
    async fn set_voice(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        voice: &VoiceConfig,
    ) -> Result<(), AgentGitError> {
        // Serialized with delete and pushes on every replica, so a voice
        // change never revives a repo.
        let _lock = self
            .adapters
            .repos
            .lock_repo(agent_user_id)
            .await
            .map_err(internal)?;
        self.team_repo(agent_user_id, team_id).await?;
        let contents = voice.to_file_contents().map_err(internal)?;

        self.adapters
            .store
            .commit_file(
                agent_user_id,
                VOICE_PATH,
                contents.as_bytes(),
                VOICE_COMMIT_MESSAGE,
            )
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
            .ok_or(AgentGitError::InvalidToken)?;

        // The kill switch: with the rollout off for the agent (as its brain
        // checks it), its repo looks absent to every credential.
        if !self.rollout_on(agent_user_id).await {
            return Err(AgentGitError::NotFound);
        }

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

        if request.endpoint == GitEndpoint::Rpc(GitService::ReceivePack)
            && request.content_encoding.is_some()
        {
            return Err(AgentGitError::EncodedPush);
        }

        let receive_pack = request.endpoint == GitEndpoint::Rpc(GitService::ReceivePack);
        let mut max_input_size = None;
        let mut lock = None;
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

            if receive_pack {
                // Rate-limit first, so a flood of pushes never reaches the lock.
                if !self
                    .adapters
                    .limiter
                    .try_acquire_push(agent_user_id)
                    .await
                    .map_err(internal)?
                {
                    return Err(AgentGitError::PushRateLimited);
                }

                // A push holds the repo's lock until its response ends, so
                // pushes from any replica, and management, never interleave
                // on disk. One that finds it held is busy: git retries.
                lock = Some(
                    self.adapters
                        .repos
                        .try_lock_repo(agent_user_id)
                        .await
                        .map_err(internal)?
                        .ok_or(AgentGitError::RepoBusy)?,
                );

                self.adapters
                    .repos
                    .record_push(agent_user_id, size_bytes)
                    .await
                    .map_err(internal)?;

                max_input_size = Some(limit_bytes - size_bytes);
                request.body = limit_body(request.body, limit_bytes - size_bytes);
            }
        }

        let mut response = self
            .adapters
            .backend
            .serve(
                &AuthorizedRepo::new(repo.agent_user_id, access, max_input_size),
                request,
            )
            .await
            .map_err(internal)?;
        if let Some(lock) = lock {
            response.body = Box::pin(response.body.map(move |chunk| {
                let _held = &lock;
                chunk
            }));
        }
        Ok(response)
    }
}

#[cfg(test)]
mod test;

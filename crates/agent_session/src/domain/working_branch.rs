//! Persist runtime branch facts independently of whether a pull request exists.

use std::pin::Pin;

use macro_user_id::user_id::MacroUserIdStr;

use super::error::{AgentSessionError, Result};
use super::model::{AgentSessionId, SessionClaim};
use super::ports::{AgentSessionRealtime, AgentSessionRepo};
use super::repository_branch::RepositoryBranch;

#[cfg(test)]
mod test;

/// Host operation for authoritative provider repository and branch facts.
pub trait SessionWorkingBranches: Send + Sync {
    /// Persist only facts for the owner's configured repository. Unrelated or
    /// invalid provider facts return `None`, without blocking transcript replay.
    fn set_working_branch<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        repository_url: &'a str,
        branch: &'a str,
        claim: Option<SessionClaim>,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>>> + Send + 'a>>;
}

/// Result of writing a fact while holding the session's row lock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkingBranchWrite {
    /// The branch changed and viewers need a metadata update.
    Changed,
    /// The same fact was already saved.
    Unchanged,
    /// Repository selection changed after the service read it.
    RepositoryChanged,
}

/// Atomic persistence of a branch for one session's current repository.
pub trait SessionWorkingBranchRepo: Send + Sync {
    /// Fence the write, verify owner and repository, and change only the
    /// working branch. Repeated facts must not reorder the session list.
    fn record_working_branch(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        expected_repository_url: &str,
        branch: &RepositoryBranch,
        claim: Option<SessionClaim>,
    ) -> impl Future<Output = Result<WorkingBranchWrite>> + Send;
}

/// Owner authorization and repository matching around runtime branch storage.
pub struct SessionWorkingBranchService<R, Rt> {
    repo: R,
    realtime: Rt,
}

impl<R, Rt> SessionWorkingBranchService<R, Rt> {
    /// Build the operation with the shared session store and realtime publisher.
    pub fn new(repo: R, realtime: Rt) -> Self {
        Self { repo, realtime }
    }
}

impl<R, Rt> SessionWorkingBranches for SessionWorkingBranchService<R, Rt>
where
    R: AgentSessionRepo + SessionWorkingBranchRepo,
    Rt: AgentSessionRealtime + Send + Sync,
{
    fn set_working_branch<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        repository_url: &'a str,
        branch: &'a str,
        claim: Option<SessionClaim>,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>>> + Send + 'a>> {
        Box::pin(async move {
            let stored = self.repo.get(session).await?;
            if !stored.owner_id.is_user(owner) {
                return Err(AgentSessionError::Forbidden);
            }
            let Some(expected) = stored.repo_url.as_deref() else {
                return Ok(None);
            };
            let Some(repository) = RepositoryIdentity::parse(repository_url) else {
                tracing::warn!(%session, "ignoring unsupported runtime branch repository");
                return Ok(None);
            };
            if RepositoryIdentity::parse(expected).as_ref() != Some(&repository) {
                return Ok(None);
            }
            let Ok(branch) = RepositoryBranch::parse(branch.to_owned()) else {
                tracing::warn!(%session, "ignoring invalid runtime branch name");
                return Ok(None);
            };
            match self
                .repo
                .record_working_branch(session, owner, expected, &branch, claim)
                .await?
            {
                WorkingBranchWrite::RepositoryChanged => return Ok(None),
                WorkingBranchWrite::Unchanged => {}
                WorkingBranchWrite::Changed => {
                    if let Err(error) = self.realtime.publish_updated(session).await {
                        tracing::warn!(?error, %session, "could not publish working branch update");
                    }
                }
            }
            Ok(Some(branch.as_str().to_owned()))
        })
    }
}

/// GitHub identity matching accepts the scheme-less form in Cursor result
/// events, but rejects credentials, alternate hosts, and extra path segments.
#[derive(Debug, PartialEq, Eq)]
struct RepositoryIdentity(String);

impl RepositoryIdentity {
    fn parse(value: &str) -> Option<Self> {
        let (_, owner, repo) = lazy_regex::regex_captures!(
            r"\A(?i:(?:https://)?github\.com)/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+)/?\z",
            value
        )?;
        let repo = repo.strip_suffix(".git").unwrap_or(repo);
        if [owner, repo]
            .iter()
            .any(|part| part.is_empty() || *part == "." || *part == "..")
        {
            return None;
        }
        Some(Self(format!("{owner}/{repo}").to_ascii_lowercase()))
    }
}

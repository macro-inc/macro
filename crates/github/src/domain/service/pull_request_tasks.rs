//! Linking a pull request to a Macro task from outside the webhook.
//!
//! The webhook links a pull request to the tasks its text references; a coding
//! session that knows both its task and its pull request links them directly.
//! Both write the same additive `github_pr_tasks` record, so later webhook
//! events (merge, close) reach the task either way.

use crate::domain::models::{GithubError, GithubKey, MacroTaskId};
use crate::domain::ports::GithubSyncRepo;

#[cfg(test)]
mod test;

/// Records pull request to task links.
pub struct PullRequestTaskLinkService<Repo> {
    repo: Repo,
}

impl<Repo: GithubSyncRepo> PullRequestTaskLinkService<Repo> {
    /// Build the service over the store the webhook links through.
    pub fn new(repo: Repo) -> Self {
        Self { repo }
    }

    /// Link `pull_request` to `task`. Linking an existing pair changes nothing,
    /// and other tasks linked to the pull request stay linked.
    #[tracing::instrument(skip(self), err)]
    pub async fn link(
        &self,
        pull_request: GithubKey,
        task: MacroTaskId,
    ) -> Result<(), GithubError> {
        self.repo
            .upsert_task_ids(pull_request, &[task])
            .await
            .map_err(|error| GithubError::Internal(error.into()))
    }
}

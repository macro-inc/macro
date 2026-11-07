//! Reading the linked pull request, independently of the session's harness.

use agent_session::domain::model::AgentSession;

use github_pull_requests::domain::models::{
    GithubPullRequestChangesError, GithubPullRequestDiffError,
};
use github_pull_requests::domain::ports::GithubPullRequestChangesets;
use macro_uuid::Uuid;

use super::error::ExtractError;
use super::model::{ExtractedChangeset, PullRequestRef};
use super::ports::ChangesetExtractor;

#[cfg(test)]
mod test;

/// Extracts only the diff of a session's linked GitHub pull request, shared
/// with every other reader of the same base and head.
pub struct PullRequestChanges<Changesets> {
    changesets: Changesets,
}

impl<Changesets> PullRequestChanges<Changesets> {
    /// Read pull request changes through `changesets`.
    pub fn new(changesets: Changesets) -> Self {
        Self { changesets }
    }
}

impl<Changesets: GithubPullRequestChangesets> ChangesetExtractor
    for PullRequestChanges<Changesets>
{
    async fn extract(&self, session: &AgentSession) -> Result<ExtractedChangeset, ExtractError> {
        let url = session.pull_request_url.as_deref().ok_or_else(|| {
            ExtractError::NotReady(
                "Link a GitHub pull request to this session to review its changes.".to_owned(),
            )
        })?;
        let pull_request = PullRequestRef::parse(url).ok_or_else(|| {
            ExtractError::NotReady("The linked URL is not a GitHub pull request.".to_owned())
        })?;
        // The diff is read through the GitHub App on the owner's behalf, so
        // the owner has to be a person.
        let owner = session
            .owner_user()
            .map_err(|error| ExtractError::Failed(rootcause::report!(error).into()))?;
        let changeset = self
            .changesets
            .capture(owner, &pull_request)
            .await
            .map_err(extract_error)?;
        Ok(ExtractedChangeset::PullRequest(changeset))
    }

    async fn pull_request_patch(
        &self,
        session: &AgentSession,
        changeset: Uuid,
    ) -> Result<Option<String>, rootcause::Report> {
        let owner = session
            .owner_user()
            .map_err(|error| rootcause::report!(error))?;
        match self.changesets.patch(owner, changeset).await {
            Ok(patch) => Ok(Some(patch)),
            Err(GithubPullRequestChangesError::NotFound | GithubPullRequestChangesError::Moved) => {
                Ok(None)
            }
            Err(GithubPullRequestChangesError::Diff(error)) if error.user_message().is_some() => {
                Ok(None)
            }
            Err(error) => Err(rootcause::report!("{error}")),
        }
    }
}

fn extract_error(error: GithubPullRequestChangesError) -> ExtractError {
    let not_ready = |reason: &str| ExtractError::NotReady(reason.to_owned());
    match error {
        GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::NotFound) => {
            not_ready("The linked pull request is not available on GitHub.")
        }
        GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::TooLarge) => {
            not_ready("This pull request is too large to load here. Review it on GitHub.")
        }
        GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::Unavailable) => not_ready(
            "Macro's GitHub App cannot read this pull request. Check its repository access.",
        ),
        GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::Other(error)) => {
            ExtractError::Failed(rootcause::report!("{error:#}"))
        }
        error => ExtractError::Failed(rootcause::report!("{error}")),
    }
}

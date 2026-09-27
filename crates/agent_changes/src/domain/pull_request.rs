//! Reading the linked pull request, independently of the session's harness.

use agent_session::domain::model::AgentSession;

use github_pull_requests::domain::models::GithubPullRequestDiffError;
use github_pull_requests::domain::ports::GithubPullRequestDiffReader;

use super::error::ExtractError;
use super::model::{ChangesetSource, ExtractedChangeset, PullRequestRef};
use super::ports::ChangesetExtractor;

#[cfg(test)]
mod test;

/// Extracts only the diff of a session's linked GitHub pull request.
pub struct PullRequestChanges<Reader> {
    reader: Reader,
}

impl<Reader> PullRequestChanges<Reader> {
    /// Read pull requests through `reader`.
    pub fn new(reader: Reader) -> Self {
        Self { reader }
    }
}

impl<Reader: GithubPullRequestDiffReader> ChangesetExtractor for PullRequestChanges<Reader> {
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
        let diff = self.reader.read(owner, &pull_request).await.map_err(|error| match error {
            GithubPullRequestDiffError::NotFound => ExtractError::NotReady("The linked pull request is not available on GitHub.".to_owned()),
            GithubPullRequestDiffError::TooLarge => ExtractError::NotReady("This pull request is too large to load here. Review it on GitHub.".to_owned()),
            GithubPullRequestDiffError::Unavailable => ExtractError::NotReady("Macro's GitHub App cannot read this pull request. Check its repository access.".to_owned()),
            GithubPullRequestDiffError::Other(error) => ExtractError::Failed(rootcause::report!("{error:#}")),
        })?;
        Ok(ExtractedChangeset {
            source: ChangesetSource::GithubPullRequest,
            range: diff.range,
            patch: diff.patch,
            truncated: false,
        })
    }
}

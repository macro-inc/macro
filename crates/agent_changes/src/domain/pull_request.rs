//! Reading the linked pull request, independently of the session's harness.

use agent_session::domain::model::AgentSession;

use super::error::{CompareError, ExtractError};
use super::model::{ChangesetSource, ExtractedChangeset, PullRequestRef};
use super::ports::{ChangesetExtractor, PullRequestDiffReader};

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

impl<Reader: PullRequestDiffReader> ChangesetExtractor for PullRequestChanges<Reader> {
    async fn extract(&self, session: &AgentSession) -> Result<ExtractedChangeset, ExtractError> {
        let url = session.pull_request_url.as_deref().ok_or_else(|| {
            ExtractError::NotReady(
                "Link a GitHub pull request to this session to review its changes.".to_owned(),
            )
        })?;
        let pull_request = PullRequestRef::parse(url).ok_or_else(|| {
            ExtractError::NotReady("The linked URL is not a GitHub pull request.".to_owned())
        })?;
        let diff = self.reader.read(&session.owner_id, &pull_request).await.map_err(|error| match error {
            CompareError::NotFound => ExtractError::NotReady("The linked pull request is not available on GitHub.".to_owned()),
            CompareError::TooLarge => ExtractError::NotReady("This pull request is too large to load here. Review it on GitHub.".to_owned()),
            CompareError::Unavailable => ExtractError::NotReady("Macro's GitHub App cannot read this pull request. Check its repository access.".to_owned()),
            CompareError::Other(report) => ExtractError::Failed(report),
        })?;
        Ok(ExtractedChangeset {
            source: ChangesetSource::GithubPullRequest,
            range: diff.range,
            patch: diff.patch,
            truncated: false,
        })
    }
}

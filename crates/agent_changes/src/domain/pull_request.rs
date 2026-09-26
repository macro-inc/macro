//! Reading the linked pull request, independently of the session's harness.

use agent_session::domain::model::AgentSession;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

use super::error::{CompareError, ExtractError};
use super::model::{
    ChangedFile, ChangesetId, ChangesetRange, ChangesetSource, ExtractedChangeset, PullRequestRef,
};
use super::patch::{MAX_FILE_PATCH_BYTES, MAX_PATCH_BYTES, budget_patch, parse_git_patch, totals};
use super::ports::{ChangesetExtractor, PullRequestDiffReader};

#[cfg(test)]
mod test;

/// Extracts only the diff of a session's linked GitHub pull request.
pub struct PullRequestChanges<Reader> {
    reader: Arc<Reader>,
}

impl<Reader> PullRequestChanges<Reader> {
    /// Read pull requests through `reader`.
    pub fn new(reader: Reader) -> Self {
        Self {
            reader: Arc::new(reader),
        }
    }
}

impl<Reader> Clone for PullRequestChanges<Reader> {
    fn clone(&self) -> Self {
        Self {
            reader: Arc::clone(&self.reader),
        }
    }
}

/// A standalone pull request snapshot, with its summary and patch read together.
pub struct PullRequestSnapshot {
    /// Unique identity of this read.
    pub id: ChangesetId,
    /// The repository and refs reported by GitHub.
    pub range: ChangesetRange,
    /// Every changed file, including files whose patches exceeded the budget.
    pub files: Vec<ChangedFile>,
    /// Total lines added.
    pub additions: u32,
    /// Total lines removed.
    pub deletions: u32,
    /// The patch remaining after applying the shared size budget.
    pub patch: String,
    /// Whether any file patches were omitted.
    pub truncated: bool,
    /// When this snapshot was read.
    pub captured_at: DateTime<Utc>,
}

/// Reads standalone pull requests using the requesting user's repository access.
pub trait PullRequestChangesService: Send + Sync + 'static {
    /// Read one PR, independently of any coding session.
    fn changes(
        &self,
        user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> impl Future<Output = Result<PullRequestSnapshot, CompareError>> + Send;
}

impl<Reader: PullRequestDiffReader> PullRequestChangesService for PullRequestChanges<Reader> {
    async fn changes(
        &self,
        user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> Result<PullRequestSnapshot, CompareError> {
        let diff = self.reader.read(user, pull_request).await?;
        let budgeted = budget_patch(
            parse_git_patch(&diff.patch),
            MAX_PATCH_BYTES,
            MAX_FILE_PATCH_BYTES,
        );
        let (additions, deletions) = totals(&budgeted.files);
        Ok(PullRequestSnapshot {
            id: ChangesetId::new(),
            range: diff.range,
            files: budgeted.files,
            additions,
            deletions,
            patch: budgeted.patch,
            truncated: budgeted.truncated,
            captured_at: Utc::now(),
        })
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
        // The diff is read through the GitHub App on the owner's behalf, so
        // the owner has to be a person.
        let owner = session
            .owner_user()
            .map_err(|error| ExtractError::Failed(rootcause::report!(error).into()))?;
        let diff = self.reader.read(owner, &pull_request).await.map_err(|error| match error {
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

//! Changes of a Cursor cloud agent, read from the branch it pushed.
//!
//! Cursor works in its own VM and pushes to a branch it names on the run's
//! terminal event; that branch on GitHub is the only place its work can be
//! read from. So: the journal says which branch, the repository says which
//! branch to compare against, and GitHub renders the diff between the two.

use agent_changes::domain::error::{CompareError, ExtractError};
use agent_changes::domain::model::{
    ChangesetRange, ChangesetSource, ExtractedChangeset, GitRef, RepositorySlug,
};
use agent_changes::domain::ports::{ChangesetExtractor, RepositoryCompare};
use agent_session::domain::model::AgentSession;
use cursor_cloud_agents::domain::ports::PushedBranches;

#[cfg(test)]
mod test;

/// [`ChangesetExtractor`] for sessions served by Cursor cloud agents.
pub struct CursorChangesetExtractor<Branches, Compare> {
    branches: Branches,
    compare: Compare,
}

impl<Branches, Compare> CursorChangesetExtractor<Branches, Compare> {
    /// Read pushed branches from `branches` and diff them with `compare`.
    pub fn new(branches: Branches, compare: Compare) -> Self {
        Self { branches, compare }
    }
}

impl<Branches, Compare> ChangesetExtractor for CursorChangesetExtractor<Branches, Compare>
where
    Branches: PushedBranches,
    Compare: RepositoryCompare,
{
    #[tracing::instrument(skip_all, err, fields(agent.session.id = %session.id))]
    async fn extract(&self, session: &AgentSession) -> Result<ExtractedChangeset, ExtractError> {
        let pushed = self
            .branches
            .latest_pushed_branch(session.id.as_uuid())
            .await
            .map_err(ExtractError::Failed)?;
        let Some(pushed) = pushed else {
            return Err(ExtractError::NotReady(
                "Cursor has not pushed a branch for this session yet.".to_owned(),
            ));
        };
        let Some(branch) = pushed.branch.filter(|name| !name.is_empty()) else {
            return Err(ExtractError::NotReady(
                "Cursor has not pushed a branch for this session yet.".to_owned(),
            ));
        };
        // Cursor names the repository without a scheme; the session row has
        // the url it was created with. Either spelling parses to the same
        // slug, and Cursor's is the one the branch actually lives in.
        let repository = RepositorySlug::parse(&pushed.repo_url)
            .or_else(|| session.repo_url.as_deref().and_then(RepositorySlug::parse))
            .ok_or_else(|| {
                ExtractError::Failed(rootcause::report!(
                    "cursor pushed to an unrecognized repository: {}",
                    pushed.repo_url
                ))
            })?;

        let base = self
            .compare
            .default_branch(&session.owner_id, &repository)
            .await
            .map_err(compare_error)?;
        let comparison = self
            .compare
            .compare(&session.owner_id, &repository, &base, &branch)
            .await
            .map_err(compare_error)?;

        Ok(ExtractedChangeset {
            source: ChangesetSource::CursorGithubCompare,
            range: ChangesetRange {
                repository: Some(repository.https_url()),
                base: GitRef {
                    name: Some(base),
                    sha: comparison.base_sha,
                },
                head: GitRef {
                    name: Some(branch),
                    sha: comparison.head_sha,
                },
            },
            patch: comparison.patch,
            truncated: false,
        })
    }
}

/// What a compare failure means to the person looking at the pane.
fn compare_error(error: CompareError) -> ExtractError {
    match error {
        CompareError::NotFound => ExtractError::NotReady(
            "The branch Cursor pushed is not on GitHub yet. Try again in a moment.".to_owned(),
        ),
        CompareError::TooLarge => ExtractError::NotReady(
            "This diff is too large for GitHub to compare. Review it on GitHub instead.".to_owned(),
        ),
        CompareError::Unavailable => ExtractError::NotReady(
            "Macro's GitHub App cannot reach this repository. Install it on the repository to review changes here."
                .to_owned(),
        ),
        CompareError::Other(report) => ExtractError::Failed(report),
    }
}

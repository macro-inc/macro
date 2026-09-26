//! Domain models for GitHub pull request records.

#[cfg(test)]
mod test;

mod key;
mod pull_request;

use foreign_entity::domain::models::{ForeignEntity, ForeignEntityError, SourceId};

pub use key::GithubKey;
pub use pull_request::{
    EnrichGithubPullRequestsProxyRequest, EnrichGithubPullRequestsResponse,
    EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
    GithubPullRequestCheckRun, GithubPullRequestComment, GithubPullRequestDetails,
    GithubPullRequestRef, GithubPullRequestStatus,
};

/// A pull request's latest data, for the record stored for one source.
#[derive(Debug, Clone)]
pub struct UpsertGithubPullRequest {
    /// The pull request's latest data. Fields it leaves out keep their stored values.
    pub pull_request: EnrichedGithubPullRequest,
    /// The user or team the record is stored for.
    pub stored_for: SourceId,
}

/// A pull request's record for one source after an upsert.
#[derive(Debug, Clone)]
pub struct UpsertedGithubPullRequest {
    /// The pull request's record for the source.
    pub foreign_entity: ForeignEntity,
    /// The status stored for the source before this upsert, when its record already existed.
    pub previous_status: Option<GithubPullRequestStatus>,
    /// Stable numeric GitHub user ids of everyone involved in the pull request, after merging.
    pub participant_github_user_ids: Vec<String>,
}

/// Errors from storing GitHub pull requests.
#[derive(Debug, thiserror::Error)]
pub enum GithubPullRequestError {
    /// The pull request could not be serialized into record metadata.
    #[error("failed to serialize pull request metadata: {0}")]
    Metadata(#[from] serde_json::Error),
    /// The foreign entity store failed.
    #[error(transparent)]
    ForeignEntity(#[from] ForeignEntityError),
}

//! Domain models for GitHub pull request records.

#[cfg(test)]
mod test;

mod key;
mod pull_request;

use chrono::{DateTime, Utc};
use foreign_entity::domain::models::{ForeignEntity, ForeignEntityError, SourceId};

pub use key::GithubKey;
pub use pull_request::{
    EnrichGithubPullRequestsProxyRequest, EnrichGithubPullRequestsResponse,
    EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
    GithubPullRequestCheckRun, GithubPullRequestComment, GithubPullRequestDetails,
    GithubPullRequestLabel, GithubPullRequestRef, GithubPullRequestReview,
    GithubPullRequestReviewDecision, GithubPullRequestReviewState, GithubPullRequestStatus,
    GithubPullRequestUser, latest_reviews,
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

/// A GitHub repository's stable id together with its current name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubRepositoryIdentity {
    /// The numeric GitHub repository id.
    pub id: u64,
    /// The account the repository lives under.
    pub owner: String,
    /// The repository name, without its owner.
    pub name: String,
}

/// A pull request's typed columns, read from its records' metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct GithubPullRequestRow {
    /// The pull request's `owner/repo/pull/number` key.
    pub github_key: String,
    /// The numeric GitHub repository id. `None` when the metadata does not carry one, in which
    /// case an existing row keeps the id it has.
    pub repository_id: Option<i64>,
    /// The pull request number within its repository.
    pub number: i64,
    /// The repository owner the pull request was last synced under.
    pub owner: String,
    /// The repository name the pull request was last synced under.
    pub repo: String,
    /// The pull request title.
    pub title: Option<String>,
    /// The normalized pull request status.
    pub status: Option<GithubPullRequestStatus>,
    /// Whether the pull request is a draft.
    pub draft: bool,
    /// Stable numeric GitHub user id of the author.
    pub author_github_user_id: Option<String>,
    /// The author's GitHub login when the pull request was last synced.
    pub author_login: Option<String>,
    /// Stable numeric GitHub user ids of the users asked to review.
    pub requested_reviewer_github_user_ids: Vec<String>,
    /// Stable numeric GitHub user ids of everyone involved.
    pub participant_github_user_ids: Vec<String>,
    /// When GitHub last updated the pull request.
    pub github_updated_at: Option<DateTime<Utc>>,
    /// The users assigned to the pull request.
    pub assignees: Vec<GithubPullRequestUser>,
    /// The pull request's labels.
    pub labels: Vec<GithubPullRequestLabel>,
    /// Each reviewer's latest submitted review.
    pub reviews: Vec<GithubPullRequestReview>,
    /// Where the review stands, derived from `reviews` and the outstanding review requests.
    pub review_decision: Option<GithubPullRequestReviewDecision>,
}

impl GithubPullRequestRow {
    /// Read the typed columns from a pull request record's metadata. `None` when the metadata is
    /// not pull request metadata.
    pub fn from_metadata(metadata: &serde_json::Value) -> Option<Self> {
        let pull_request: EnrichedGithubPullRequest =
            serde_json::from_value(metadata.clone()).ok()?;

        Some(Self {
            repository_id: pull_request
                .repository_id
                .and_then(|id| i64::try_from(id).ok()),
            number: i64::try_from(pull_request.number).ok()?,
            github_key: pull_request.github_key,
            owner: pull_request.owner,
            repo: pull_request.repo,
            title: pull_request.name,
            status: pull_request.status,
            draft: pull_request.draft.unwrap_or(false),
            author_github_user_id: pull_request.author_id.map(|id| id.to_string()),
            author_login: pull_request.author_login,
            participant_github_user_ids: pull_request
                .participant_github_user_ids
                .unwrap_or_default(),
            github_updated_at: pull_request.github_updated_at,
            assignees: pull_request.assignees.unwrap_or_default(),
            labels: pull_request.labels.unwrap_or_default(),
            review_decision: GithubPullRequestReviewDecision::derive(
                pull_request.reviews.as_deref().unwrap_or_default(),
                pull_request
                    .requested_reviewer_github_user_ids
                    .as_deref()
                    .unwrap_or_default(),
            ),
            reviews: pull_request.reviews.unwrap_or_default(),
            requested_reviewer_github_user_ids: pull_request
                .requested_reviewer_github_user_ids
                .unwrap_or_default(),
        })
    }
}

/// Repositories and authors among the GitHub pull requests a caller can see, each with the
/// number of pull requests it covers.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestFacets {
    /// Repositories, most pull requests first.
    pub repositories: Vec<GithubRepositoryFacet>,
    /// Authors, most pull requests first.
    pub authors: Vec<GithubAuthorFacet>,
}

/// A repository among the visible GitHub pull requests.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubRepositoryFacet {
    /// The numeric GitHub repository id, which survives renames and transfers.
    pub repository_id: String,
    /// The repository's most recently synced name, as `owner/repo`.
    pub repository: String,
    /// Number of visible pull requests in the repository.
    pub count: i64,
}

/// An author among the visible GitHub pull requests.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubAuthorFacet {
    /// The author's numeric GitHub user id.
    pub github_user_id: String,
    /// The author's most recently synced GitHub login, when known.
    pub login: Option<String>,
    /// Number of visible pull requests the author opened.
    pub count: i64,
}

/// Errors from storing GitHub pull requests.
#[derive(Debug, thiserror::Error)]
pub enum GithubPullRequestError {
    /// The request was malformed.
    #[error("{0}")]
    BadRequest(String),
    /// The pull request could not be serialized into record metadata.
    #[error("failed to serialize pull request metadata: {0}")]
    Metadata(#[from] serde_json::Error),
    /// The foreign entity store failed.
    #[error(transparent)]
    ForeignEntity(#[from] ForeignEntityError),
    /// The pull request row store failed.
    #[error("pull request row storage failed: {0}")]
    Repository(anyhow::Error),
}

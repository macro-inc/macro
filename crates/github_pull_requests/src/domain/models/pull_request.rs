//! GitHub pull request models and the rules for merging them into stored metadata.

use std::fmt;

use serde::{Deserialize, Serialize};

use super::GitRef;

/// Foreign entity source used for GitHub pull request records.
pub const GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE: &str = "github_pull_request";

/// A pull request reference that can be enriched with live GitHub data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestRef {
    /// The stored GitHub association key, in `owner/repo/pull/number` format.
    pub github_key: String,
    /// The GitHub repository owner or organization.
    pub owner: String,
    /// The GitHub repository name.
    pub repo: String,
    /// The GitHub pull request number.
    pub number: u64,
    /// The public GitHub URL for the pull request.
    pub url: String,
    /// A compact label suitable for display in the UI.
    pub display_name: String,
}

/// The normalized lifecycle status for a GitHub pull request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum GithubPullRequestStatus {
    /// The pull request is open.
    Open,
    /// The pull request is closed without being merged.
    Closed,
    /// The pull request is closed and merged.
    Merged,
}

impl GithubPullRequestStatus {
    /// Derive the normalized status from GitHub API pull request details.
    pub fn from_details(details: &GithubPullRequestDetails) -> Self {
        if details.state == "closed" {
            if details.merged_at.is_some() {
                return Self::Merged;
            }

            return Self::Closed;
        }

        Self::Open
    }

    /// Return the status as the API string representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::Merged => "merged",
        }
    }
}

impl fmt::Display for GithubPullRequestStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

fn deserialize_optional_array<'de, D, T>(deserializer: D) -> Result<Option<Vec<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = serde_json::Value::deserialize(deserializer)?;

    if value.is_null() {
        return Ok(None);
    }

    if !value.is_array() {
        return Ok(None);
    }

    Vec::<T>::deserialize(value)
        .map(Some)
        .map_err(serde::de::Error::custom)
}

/// A comment associated with a GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestComment {
    /// The unique GitHub identifier for the comment or review.
    pub id: u64,
    /// The comment or review body text.
    pub body: String,
    /// The GitHub login for the comment author, when available.
    pub author_login: Option<String>,
    /// The stable numeric GitHub user id for the comment author, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<u64>,
    /// GitHub's relationship label for the author, when available.
    pub author_association: Option<String>,
    /// The public GitHub URL for the comment or review, when available.
    pub url: Option<String>,
    /// When the comment was created or the review was submitted.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// When the comment or review was last updated.
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The GitHub source for the comment, such as `issue_comment` or `review_comment`.
    pub source: String,
    /// The id of the comment this one replies to, when it is part of a review
    /// thread. Only ever present on `review_comment` sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_reply_to_id: Option<u64>,
    /// The id of the pull request review this comment was submitted with.
    /// Only ever present on `review_comment` sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request_review_id: Option<u64>,
    /// The repository-relative file path the review comment is anchored to.
    /// Only ever present on `review_comment` sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The line in the current diff the comment is anchored to. Cleared by
    /// GitHub when later commits outdate the comment's diff.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    /// The line the comment was originally anchored to, kept even when the
    /// diff has since changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_line: Option<u64>,
}

/// A check run associated with a GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestCheckRun {
    /// The unique GitHub identifier for the check run.
    pub id: u64,
    /// The check run name.
    pub name: String,
    /// The raw GitHub check run status.
    pub status: String,
    /// The raw GitHub check run conclusion, when the run has completed.
    pub conclusion: Option<String>,
    /// The public GitHub URL for the check run, when available.
    pub url: Option<String>,
    /// When the check run started, when available.
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    /// When the check run completed, when available.
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// A GitHub user named on a pull request, such as an assignee.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestUser {
    /// The stable numeric GitHub user id, as a string.
    pub github_user_id: String,
    /// The user's GitHub login, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
}

/// A label on a GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestLabel {
    /// The label name, unique within its repository regardless of case.
    pub name: String,
    /// The label color as six hex digits without a leading `#`, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// What a reviewer's latest review on a pull request said.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum GithubPullRequestReviewState {
    /// The reviewer approved the changes.
    Approved,
    /// The reviewer asked for changes.
    ChangesRequested,
    /// The reviewer commented without approving or asking for changes.
    Commented,
    /// The reviewer's review was dismissed.
    Dismissed,
}

impl GithubPullRequestReviewState {
    /// The state GitHub reports for a submitted review, such as `APPROVED`. `None` for a pending
    /// review, which only its author can see.
    pub fn from_github(state: &str) -> Option<Self> {
        match state.to_ascii_uppercase().as_str() {
            "APPROVED" => Some(Self::Approved),
            "CHANGES_REQUESTED" => Some(Self::ChangesRequested),
            "COMMENTED" => Some(Self::Commented),
            "DISMISSED" => Some(Self::Dismissed),
            _ => None,
        }
    }
}

/// A reviewer's latest submitted review on a pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestReview {
    /// The stable numeric GitHub user id of the reviewer, as a string.
    pub reviewer_github_user_id: String,
    /// The reviewer's GitHub login, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewer_login: Option<String>,
    /// What the review said.
    pub state: GithubPullRequestReviewState,
    /// When the review was submitted, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl GithubPullRequestReview {
    /// Whether this review replaces `current` as its reviewer's latest. An approval, change
    /// request, or dismissal always outranks a comment, regardless of input order or submission
    /// time. Otherwise the later submission wins, a review with no submission time loses to one
    /// with a time, and a tie goes to this review.
    fn supersedes(&self, current: &Self) -> bool {
        match (
            self.state == GithubPullRequestReviewState::Commented,
            current.state == GithubPullRequestReviewState::Commented,
        ) {
            (true, false) => false,
            (false, true) => true,
            _ => self.submitted_at >= current.submitted_at,
        }
    }
}

/// Each reviewer's latest review among `reviews`, taken in order, ordered by reviewer id.
pub fn latest_reviews(
    reviews: impl IntoIterator<Item = GithubPullRequestReview>,
) -> Vec<GithubPullRequestReview> {
    let mut latest: std::collections::BTreeMap<String, GithubPullRequestReview> =
        std::collections::BTreeMap::new();
    for review in reviews {
        let replaces = latest
            .get(&review.reviewer_github_user_id)
            .is_none_or(|current| review.supersedes(current));
        if replaces {
            latest.insert(review.reviewer_github_user_id.clone(), review);
        }
    }
    latest.into_values().collect()
}

/// Where a pull request's review stands, from its reviewers' latest reviews.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum GithubPullRequestReviewDecision {
    /// A reviewer's latest review approves and none asks for changes.
    Approved,
    /// A reviewer's latest review asks for changes.
    ChangesRequested,
    /// Reviews are requested and none has approved or asked for changes yet.
    ReviewRequired,
}

impl GithubPullRequestReviewDecision {
    /// Derive the decision from each reviewer's latest review and the outstanding review
    /// requests. Unlike GitHub's own decision it does not know how many approvals branch
    /// protection requires.
    pub fn derive(
        reviews: &[GithubPullRequestReview],
        requested_reviewer_github_user_ids: &[String],
    ) -> Option<Self> {
        let states = || reviews.iter().map(|review| review.state);
        if states().any(|state| state == GithubPullRequestReviewState::ChangesRequested) {
            return Some(Self::ChangesRequested);
        }
        if states().any(|state| state == GithubPullRequestReviewState::Approved) {
            return Some(Self::Approved);
        }
        (!requested_reviewer_github_user_ids.is_empty()).then_some(Self::ReviewRequired)
    }

    /// The decision as stored in the `github_pull_request.review_decision` column.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::ChangesRequested => "changes_requested",
            Self::ReviewRequired => "review_required",
        }
    }
}

/// GitHub API pull request details used to enrich a pull request reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct GithubPullRequestDetails {
    /// The GitHub pull request title.
    pub title: String,
    /// The raw GitHub pull request state, usually `open` or `closed`.
    pub state: String,
    /// The numeric id of the base repository, when available.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_id: Option<u64>,
    /// The merge timestamp returned by GitHub, when the pull request was merged.
    pub merged_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The number of added lines reported by GitHub.
    pub additions: u64,
    /// The number of deleted lines reported by GitHub.
    pub deletions: u64,
    /// The GitHub login for the pull request author, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_login: Option<String>,
    /// The stable numeric GitHub user id for the pull request author, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<u64>,
    /// The pull request description (body), when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Comments collected from the pull request, when enrichment includes them.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_array"
    )]
    pub comments: Option<Vec<GithubPullRequestComment>>,
    /// Check runs collected from the pull request head commit, when enrichment includes them.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_array"
    )]
    pub checks: Option<Vec<GithubPullRequestCheckRun>>,
    /// Stable numeric GitHub user ids (as strings) for everyone involved in the pull request:
    /// author, requested reviewers, reviewers, assignees, and commenters.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_array"
    )]
    pub participant_github_user_ids: Option<Vec<String>>,
    /// Whether the pull request is a draft, when available.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<bool>,
    /// Stable numeric GitHub user ids (as strings) of the users asked to review, when available.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_array"
    )]
    pub requested_reviewer_github_user_ids: Option<Vec<String>>,
    /// When GitHub last updated the pull request, when available.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The users assigned to the pull request, when available.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_array"
    )]
    pub assignees: Option<Vec<GithubPullRequestUser>>,
    /// The pull request's labels, when available.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_array"
    )]
    pub labels: Option<Vec<GithubPullRequestLabel>>,
    /// Each reviewer's latest submitted review, when enrichment includes reviews.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_array"
    )]
    pub reviews: Option<Vec<GithubPullRequestReview>>,
    /// The branch and commit the pull request merges into, when available.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<GitRef>,
    /// The branch and commit carrying the pull request's changes, when available.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<GitRef>,
}

impl GithubPullRequestDetails {
    /// Derive the normalized status for these GitHub API details.
    pub fn status(&self) -> GithubPullRequestStatus {
        GithubPullRequestStatus::from_details(self)
    }
}

/// A pull request reference enriched with live GitHub details when available.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrichedGithubPullRequest {
    /// The stored GitHub association key, in `owner/repo/pull/number` format.
    pub github_key: String,
    /// The GitHub repository owner or organization.
    pub owner: String,
    /// The GitHub repository name.
    pub repo: String,
    /// The numeric GitHub repository id, when known. Unlike `owner` and `repo`, it survives
    /// renames and transfers.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_id: Option<u64>,
    /// The GitHub pull request number.
    pub number: u64,
    /// The public GitHub URL for the pull request.
    pub url: String,
    /// A compact label suitable for display in the UI.
    pub display_name: String,
    /// The GitHub pull request title, when enrichment succeeds.
    pub name: Option<String>,
    /// The normalized GitHub pull request status, when enrichment succeeds.
    pub status: Option<GithubPullRequestStatus>,
    /// The number of added lines reported by GitHub, when enrichment succeeds.
    pub additions: Option<u64>,
    /// The number of deleted lines reported by GitHub, when enrichment succeeds.
    pub deletions: Option<u64>,
    /// The GitHub login for the pull request author, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_login: Option<String>,
    /// The stable numeric GitHub user id for the pull request author, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<u64>,
    /// The pull request description (body), when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Comments collected from the pull request, when enrichment includes them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<GithubPullRequestComment>>,
    /// Check runs collected from the pull request head commit, when enrichment includes them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checks: Option<Vec<GithubPullRequestCheckRun>>,
    /// Stable numeric GitHub user ids (as strings) for everyone involved in the pull request.
    /// Queried by the foreign entity `includes_me` filter, so stored metadata merges this as a
    /// union rather than replacing it (partial write paths must not drop known participants).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant_github_user_ids: Option<Vec<String>>,
    /// Whether the pull request is a draft, when known.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<bool>,
    /// Stable numeric GitHub user ids (as strings) of the users asked to review, when known.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_reviewer_github_user_ids: Option<Vec<String>>,
    /// When GitHub last updated the pull request, when known.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The users assigned to the pull request, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignees: Option<Vec<GithubPullRequestUser>>,
    /// The pull request's labels, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<GithubPullRequestLabel>>,
    /// Each reviewer's latest submitted review, when known. Stored metadata merges this per
    /// reviewer, so a write that knows one review keeps the others.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviews: Option<Vec<GithubPullRequestReview>>,
    /// The branch and commit the pull request merges into, when known.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<GitRef>,
    /// The branch and commit carrying the pull request's changes, when known.
    #[cfg_attr(feature = "schema", schema(ignore))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<GitRef>,
}

impl EnrichedGithubPullRequest {
    /// Create an unenriched response that preserves the base pull request reference.
    pub fn from_reference(reference: GithubPullRequestRef) -> Self {
        Self {
            github_key: reference.github_key,
            owner: reference.owner,
            repo: reference.repo,
            repository_id: None,
            number: reference.number,
            url: reference.url,
            display_name: reference.display_name,
            name: None,
            status: None,
            additions: None,
            deletions: None,
            author_login: None,
            author_id: None,
            description: None,
            comments: None,
            checks: None,
            participant_github_user_ids: None,
            draft: None,
            requested_reviewer_github_user_ids: None,
            github_updated_at: None,
            assignees: None,
            labels: None,
            reviews: None,
            base: None,
            head: None,
        }
    }

    /// Create an enriched response from a base pull request reference and GitHub details.
    pub fn from_details(
        reference: GithubPullRequestRef,
        details: GithubPullRequestDetails,
    ) -> Self {
        let status = details.status();

        Self {
            github_key: reference.github_key,
            owner: reference.owner,
            repo: reference.repo,
            repository_id: details.repository_id,
            number: reference.number,
            url: reference.url,
            display_name: reference.display_name,
            name: Some(details.title),
            status: Some(status),
            additions: Some(details.additions),
            deletions: Some(details.deletions),
            author_login: details.author_login,
            author_id: details.author_id,
            description: details.description,
            comments: details.comments,
            checks: details.checks,
            participant_github_user_ids: details.participant_github_user_ids,
            draft: details.draft,
            requested_reviewer_github_user_ids: details.requested_reviewer_github_user_ids,
            github_updated_at: details.github_updated_at,
            assignees: details.assignees,
            labels: details.labels,
            reviews: details.reviews,
            base: details.base,
            head: details.head,
        }
    }

    /// Serialize this pull request into the metadata shape stored on GitHub pull request foreign entities.
    ///
    /// Partial refreshes may omit `comments` or `checks`. When an omitted field exists as an array in
    /// `existing_metadata`, the existing array is copied forward so richer metadata is not discarded.
    /// The same applies to `authorLogin`, `authorId`, `description`, `repositoryId`, `draft`,
    /// `requestedReviewerGithubUserIds`, `githubUpdatedAt`, `assignees`, `labels`, `base`, and
    /// `head`, which fallback write paths (such as comment webhooks without a `pull_request`
    /// payload) omit.
    /// `reviews` merges per reviewer, keeping each reviewer's most recently submitted review.
    pub fn foreign_entity_metadata(
        &self,
        existing_metadata: Option<&serde_json::Value>,
    ) -> serde_json::Result<serde_json::Value> {
        let mut metadata = serde_json::to_value(self)?;
        let Some(existing_object) = existing_metadata.and_then(|value| value.as_object()) else {
            return Ok(metadata);
        };
        let Some(metadata_object) = metadata.as_object_mut() else {
            return Ok(metadata);
        };

        for field in ["comments", "checks"] {
            if metadata_object.contains_key(field) {
                continue;
            }

            if let Some(existing_value) = existing_object.get(field)
                && existing_value.is_array()
            {
                metadata_object.insert(field.to_string(), existing_value.clone());
            }
        }

        for field in [
            "authorLogin",
            "authorId",
            "description",
            "repositoryId",
            "draft",
            "requestedReviewerGithubUserIds",
            "githubUpdatedAt",
            "assignees",
            "labels",
            "base",
            "head",
        ] {
            if metadata_object.contains_key(field) {
                continue;
            }

            if let Some(existing_value) = existing_object.get(field)
                && !existing_value.is_null()
            {
                metadata_object.insert(field.to_string(), existing_value.clone());
            }
        }

        const REVIEWS_FIELD: &str = "reviews";
        let reviews = merge_reviews(
            existing_object.get(REVIEWS_FIELD),
            metadata_object.get(REVIEWS_FIELD),
        );
        if !reviews.is_empty() {
            metadata_object.insert(REVIEWS_FIELD.to_string(), serde_json::to_value(reviews)?);
        }

        // Participants are unioned rather than carried forward or replaced: write paths produce
        // partial sets (a webhook fallback knows the author/reviewers/assignees but not the
        // commenters), so replacing would drop participants a richer earlier write discovered.
        const PARTICIPANTS_FIELD: &str = "participantGithubUserIds";
        let mut participants: std::collections::BTreeSet<String> = [
            existing_object.get(PARTICIPANTS_FIELD),
            metadata_object.get(PARTICIPANTS_FIELD),
        ]
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_array())
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();

        if !participants.is_empty() {
            metadata_object.insert(
                PARTICIPANTS_FIELD.to_string(),
                serde_json::Value::Array(
                    std::mem::take(&mut participants)
                        .into_iter()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }

        Ok(metadata)
    }
}

/// Each reviewer's latest review across the stored and then the incoming metadata.
fn merge_reviews(
    existing: Option<&serde_json::Value>,
    incoming: Option<&serde_json::Value>,
) -> Vec<GithubPullRequestReview> {
    let parse = |value: Option<&serde_json::Value>| -> Vec<GithubPullRequestReview> {
        value
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default()
    };
    latest_reviews(parse(existing).into_iter().chain(parse(incoming)))
}

/// How GitHub combines a pull request's commits into its base branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum GithubMergeMethod {
    /// A merge commit joining both histories.
    Merge,
    /// One squashed commit on the base branch.
    Squash,
    /// The pull request's commits replayed onto the base branch.
    Rebase,
}

impl GithubMergeMethod {
    /// The method as GitHub's `merge_method` request value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Squash => "squash",
            Self::Rebase => "rebase",
        }
    }
}

impl fmt::Display for GithubMergeMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Which merge methods a repository's settings allow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GithubRepositoryMergeSettings {
    /// Merge commits are allowed.
    pub allow_merge_commit: bool,
    /// Squash merges are allowed.
    pub allow_squash_merge: bool,
    /// Rebase merges are allowed.
    pub allow_rebase_merge: bool,
}

impl GithubRepositoryMergeSettings {
    /// The method a merge should use when the caller expressed no preference:
    /// the first allowed one in GitHub's own order, or `None` when the
    /// repository has disabled every method.
    pub fn default_method(self) -> Option<GithubMergeMethod> {
        [
            (self.allow_merge_commit, GithubMergeMethod::Merge),
            (self.allow_squash_merge, GithubMergeMethod::Squash),
            (self.allow_rebase_merge, GithubMergeMethod::Rebase),
        ]
        .into_iter()
        .find_map(|(allowed, method)| allowed.then_some(method))
    }
}

/// Why GitHub declined to merge a pull request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GithubMergeRejection {
    /// The pull request cannot be merged as it stands: conflicts, failing or
    /// pending required checks, missing reviews, a draft, or a merge method
    /// the repository does not allow.
    NotMergeable,
    /// The head branch moved since the merge was requested.
    HeadChanged,
    /// The user's token cannot see the pull request.
    NotFound,
    /// The user has no push access to the base repository.
    Forbidden,
    /// GitHub rejected the request as invalid.
    Invalid,
}

/// A merge GitHub performed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestMerge {
    /// The merge commit's SHA.
    pub sha: String,
    /// GitHub's own summary of the merge.
    pub message: String,
}

/// GitHub's answer to a merge request: performed, or declined with its reason.
///
/// A rejection is a fact about the pull request rather than a transport
/// failure, so the client reports it as a value and the domain decides what
/// to do with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubMergeOutcome {
    /// The pull request was merged.
    Merged(GithubPullRequestMerge),
    /// GitHub declined, with the message it gave for the user.
    Rejected {
        /// Why GitHub declined.
        rejection: GithubMergeRejection,
        /// GitHub's message, written for the person who asked.
        message: String,
    },
}

/// A request to merge one pull request on the user's behalf.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MergeGithubPullRequestRequest {
    /// The GitHub repository owner or organization.
    pub owner: String,
    /// The GitHub repository name.
    pub repo: String,
    /// The GitHub pull request number.
    pub number: u64,
    /// The merge method to use. Omitted means the first method the
    /// repository allows, in the order merge, squash, rebase.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge_method: Option<GithubMergeMethod>,
}

impl MergeGithubPullRequestRequest {
    /// The reference enrichment uses for this pull request.
    pub fn to_reference(&self) -> GithubPullRequestRef {
        GithubPullRequestRef {
            github_key: format!("{}/{}/pull/{}", self.owner, self.repo, self.number),
            owner: self.owner.clone(),
            repo: self.repo.clone(),
            number: self.number,
            url: format!(
                "https://github.com/{}/{}/pull/{}",
                self.owner, self.repo, self.number
            ),
            display_name: format!("{}/{}#{}", self.owner, self.repo, self.number),
        }
    }
}

/// Response body for a merged pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MergeGithubPullRequestResponse {
    /// The merge commit's SHA.
    pub sha: String,
    /// GitHub's own summary of the merge.
    pub message: String,
    /// The pull request as GitHub reports it after the merge, when the
    /// refresh succeeded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<EnrichedGithubPullRequest>,
}

/// Request body for the authenticated pull request enrichment proxy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrichGithubPullRequestsProxyRequest {
    /// The pull requests to enrich for the authenticated user.
    pub pull_requests: Vec<GithubPullRequestRef>,
}

/// Response body for pull request enrichment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrichGithubPullRequestsResponse {
    /// Pull requests with enrichment fields populated when GitHub data was available.
    pub pull_requests: Vec<EnrichedGithubPullRequest>,
}

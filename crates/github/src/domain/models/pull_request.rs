//! Domain models for GitHub pull request enrichment.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Foreign entity source used for GitHub pull request metadata rows.
pub const GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE: &str = "github_pull_request";

/// A pull request reference that can be enriched with live GitHub data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
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
}

/// A check run associated with a GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
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

/// GitHub API pull request details used to enrich a pull request reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct GithubPullRequestDetails {
    /// The GitHub pull request title.
    pub title: String,
    /// The raw GitHub pull request state, usually `open` or `closed`.
    pub state: String,
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
}

impl GithubPullRequestDetails {
    /// Derive the normalized status for these GitHub API details.
    pub fn status(&self) -> GithubPullRequestStatus {
        GithubPullRequestStatus::from_details(self)
    }
}

/// A pull request reference enriched with live GitHub details when available.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrichedGithubPullRequest {
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
}

impl EnrichedGithubPullRequest {
    /// Create an unenriched response that preserves the base pull request reference.
    pub fn from_reference(reference: GithubPullRequestRef) -> Self {
        Self {
            github_key: reference.github_key,
            owner: reference.owner,
            repo: reference.repo,
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
        }
    }

    /// Serialize this pull request into the metadata shape stored on GitHub pull request foreign entities.
    ///
    /// Partial refreshes may omit `comments` or `checks`. When an omitted field exists as an array in
    /// `existing_metadata`, the existing array is copied forward so richer metadata is not discarded.
    /// The same applies to the scalar `authorLogin`, `authorId`, and `description` fields, which
    /// fallback write paths (such as comment webhooks without a `pull_request` payload) omit.
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

        for field in ["authorLogin", "authorId", "description"] {
            if metadata_object.contains_key(field) {
                continue;
            }

            if let Some(existing_value) = existing_object.get(field)
                && !existing_value.is_null()
            {
                metadata_object.insert(field.to_string(), existing_value.clone());
            }
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

/// Request body for the authenticated pull request enrichment proxy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrichGithubPullRequestsProxyRequest {
    /// The pull requests to enrich for the authenticated user.
    pub pull_requests: Vec<GithubPullRequestRef>,
}

/// Response body for pull request enrichment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrichGithubPullRequestsResponse {
    /// Pull requests with enrichment fields populated when GitHub data was available.
    pub pull_requests: Vec<EnrichedGithubPullRequest>,
}

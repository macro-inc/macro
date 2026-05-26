//! Domain models for GitHub pull request enrichment.

use std::fmt;

use serde::{Deserialize, Serialize};

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
        }
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

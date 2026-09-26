use serde::{Deserialize, Serialize};

/// The possible literal values in a GitHub pull request filter AST. Every literal matches the
/// pull request's typed columns, so a record without them never matches.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum GithubPullRequestLiteral {
    /// The pull request's repository has this numeric GitHub id, which survives renames and
    /// transfers.
    #[serde(rename = "repo")]
    RepositoryId(i64),
    /// The pull request was opened by the GitHub user with this numeric id.
    #[serde(rename = "au")]
    Author(String),
    /// The pull request is in this state.
    #[serde(rename = "st")]
    Status(GithubPullRequestState),
    /// The GitHub user with this numeric id takes part in the pull request: author, requested
    /// reviewer, reviewer, assignee, or commenter.
    #[serde(rename = "inv")]
    Involves(String),
    /// A review is requested from the GitHub user with this numeric id.
    #[serde(rename = "rr")]
    ReviewRequested(String),
    /// Whether the pull request is a draft.
    #[serde(rename = "draft")]
    Draft(bool),
}

/// The lifecycle state of a GitHub pull request.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GithubPullRequestState {
    /// The pull request is open.
    Open,
    /// The pull request was closed without being merged.
    Closed,
    /// The pull request was merged.
    Merged,
}

impl GithubPullRequestState {
    /// The state as stored in the `github_pull_request.status` column.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::Merged => "merged",
        }
    }
}

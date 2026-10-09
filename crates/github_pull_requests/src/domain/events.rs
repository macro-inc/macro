//! Facts emitted after a pull request has been stored.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A persisted update to a pull request and its source-scoped entity records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubPullRequestUpdated {
    /// The canonical `owner/repo/pull/number` key used by session links.
    pub github_key: String,
    /// Exact foreign entity identities affected by this write.
    pub foreign_entity_ids: Vec<Uuid>,
}

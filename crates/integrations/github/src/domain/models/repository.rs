//! A GitHub repository as our App sees it.

/// A repository reachable through one of our App's installations.
///
/// The fields are the ones GitHub's repository objects always carry, so a
/// repository listed from an installation can be described without a second
/// call: `default_branch` is the only optional one, and only because an empty
/// repository has no branches yet.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
pub struct GithubRepository {
    /// The account the repository lives under - a user or an organisation.
    pub owner: String,
    /// The repository's name, without its owner.
    pub name: String,
    /// GitHub's own web page for the repository.
    pub html_url: String,
    /// The branch a clone checks out, absent for a repository with no commits.
    pub default_branch: Option<String>,
    /// Whether the repository is private.
    pub private: bool,
    /// GitHub's numeric repository id, which survives renames and transfers. Zero when it was
    /// not recorded.
    #[serde(default)]
    pub id: u64,
}

impl GithubRepository {
    /// The canonical `https://github.com/{owner}/{name}` address.
    ///
    /// Derived rather than read from `html_url`, so callers that build a clone
    /// or API URL do not depend on whatever GitHub chose to return.
    pub fn https_url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }
}

/// A request for the next page of installations whose stored pull requests to index.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestIndexRequest {
    /// Resume after this installation id; absent to start from the first installation.
    #[serde(default)]
    pub after: Option<String>,
    /// How many installations to process in this call; absent for the default page size.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// What one page of pull request indexing did.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestIndexPage {
    /// Installations processed in this page, including those that failed.
    pub installations: u32,
    /// Repositories listed across the page's installations.
    pub repositories: u32,
    /// Typed PR rows newly initialized; existing rows and retries do not count.
    pub indexed_pull_requests: u64,
    /// Initialization attempts that found a matching existing row without changing it.
    pub already_indexed_pull_requests: u64,
    /// Source records skipped because repository identity is absent.
    pub unverified_records: u64,
    /// Malformed source records or invalid keys/numbers.
    pub invalid_records: u64,
    /// Source records or initialization attempts rejected for conflicting identity.
    pub identity_conflicts: u64,
    /// Failed repository listings, source reads, row writes, or invalid repository identities.
    pub failures: u64,
    /// Installations with listing/storage failures, malformed records, or identity conflicts.
    /// Retry the original page request: using a failed ID as `after` skips that installation.
    pub failed_installation_ids: Vec<String>,
    /// Pass as `after` to continue; absent once every installation has been processed.
    pub next_after: Option<String>,
}

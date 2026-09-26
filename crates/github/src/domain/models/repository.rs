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
    /// GitHub's numeric repository id, which survives renames and transfers.
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

/// A request for the next page of installations to backfill repository ids for.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryIdBackfillRequest {
    /// Resume after this installation id; absent to start from the first installation.
    #[serde(default)]
    pub after: Option<String>,
    /// How many installations to process in this call; absent for the default page size.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// What one page of the repository id backfill did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryIdBackfillPage {
    /// Installations processed in this page, including those that failed.
    pub installations: u32,
    /// Repositories listed across the page's installations.
    pub repositories: u32,
    /// Pull request records that gained a repository id.
    pub updated_pull_requests: u64,
    /// Installations whose repositories GitHub would not list, such as suspended ones.
    pub failed_installation_ids: Vec<String>,
    /// Pass as `after` to continue; absent once every installation has been processed.
    pub next_after: Option<String>,
}

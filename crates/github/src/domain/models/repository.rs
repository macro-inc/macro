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

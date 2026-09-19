//! A GitHub repository as our App sees it.

/// Whether a repository lives under a person or an organisation.
///
/// GitHub's account `type`. Anything that is not an organisation is treated as
/// a user, including bots and omitted values: a team listing that cannot tell
/// the account apart from a person must not offer that repository to teammates.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(rename_all = "PascalCase")]
pub enum GithubAccountKind {
    /// An organisation account.
    Organization,
    /// A user account, or any account we cannot classify as an organisation.
    #[default]
    #[serde(other)]
    User,
}

impl GithubAccountKind {
    /// Whether this account is an organisation.
    #[must_use]
    pub const fn is_organization(self) -> bool {
        matches!(self, Self::Organization)
    }
}

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
    /// Whether that account is a person or an organisation.
    #[serde(default)]
    pub owner_kind: GithubAccountKind,
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

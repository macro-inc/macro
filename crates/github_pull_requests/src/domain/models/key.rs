//! The key identifying a GitHub pull request.

use std::fmt;

/// Identifies a pull request as `owner/repo/pull/number`.
#[derive(Debug, Clone)]
pub struct GithubKey(String);

impl GithubKey {
    /// Create the key for pull request `pr` in `org/repo`.
    pub fn new(org: &str, repo: &str, pr: u64) -> Self {
        Self(format!("{org}/{repo}/pull/{pr}"))
    }
}

impl fmt::Display for GithubKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl AsRef<str> for GithubKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

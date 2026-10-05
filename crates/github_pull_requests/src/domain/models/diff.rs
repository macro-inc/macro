//! Reading a pull request's diff: which pull request, and what comes back.

pub use git_patch::{ChangesetRange, GitRef};

#[cfg(test)]
mod test;

/// An `owner/name` GitHub repository, parsed from any of the spellings a
/// provider uses (`https://github.com/o/n`, `github.com/o/n`, `o/n`, with or
/// without a trailing `.git`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RepositorySlug {
    /// The account the repository lives under.
    pub owner: String,
    /// The repository's name.
    pub name: String,
}

impl RepositorySlug {
    /// Parse a repository reference. `None` when the text does not name a
    /// GitHub repository.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let trimmed = text.trim().trim_end_matches('/');
        let without_scheme = trimmed
            .strip_prefix("https://")
            .or_else(|| trimmed.strip_prefix("http://"))
            .or_else(|| trimmed.strip_prefix("git@"))
            .unwrap_or(trimmed);
        let path = without_scheme
            .strip_prefix("github.com/")
            .or_else(|| without_scheme.strip_prefix("github.com:"))
            .unwrap_or(without_scheme);
        let path = path.strip_suffix(".git").unwrap_or(path);
        let mut parts = path.split('/');
        let owner = parts.next()?;
        let name = parts.next()?;
        if parts.next().is_some() || owner.is_empty() || name.is_empty() {
            return None;
        }
        let valid = |part: &str| {
            part.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        };
        if !valid(owner) || !valid(name) {
            return None;
        }
        Some(Self {
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }

    /// The canonical `https://github.com/{owner}/{name}` address.
    #[must_use]
    pub fn https_url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }
}

impl std::fmt::Display for RepositorySlug {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}/{}", self.owner, self.name)
    }
}

/// A validated GitHub pull request URL, used to build a fixed-origin API request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestRef {
    /// The repository containing the PR, including when its head is a fork.
    pub repository: RepositorySlug,
    /// The positive GitHub pull request number.
    pub number: std::num::NonZeroU64,
}

impl PullRequestRef {
    /// Accept GitHub PR links, optionally with a files/commits suffix or fragment.
    pub fn parse(value: &str) -> Option<Self> {
        let url = url::Url::parse(value).ok()?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
        {
            return None;
        }
        let mut segments = url.path_segments()?;
        let owner = segments.next()?;
        let repo = segments.next()?;
        if segments.next()? != "pull" {
            return None;
        }
        let number = segments.next()?.parse().ok()?;
        match segments.next() {
            None => {}
            Some("") if segments.next().is_none() => {}
            Some("files" | "commits" | "checks") if segments.next().is_none() => {}
            _ => return None,
        }
        Some(Self {
            repository: RepositorySlug::parse(&format!("{owner}/{repo}"))?,
            number,
        })
    }
}

/// A pull request's patch and the base and head it actually compares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubPullRequestDiff {
    /// Git-style unified diff returned by GitHub.
    pub patch: String,
    /// The pull request's target and source, including forks and non-default bases.
    pub range: ChangesetRange,
}

/// Why a pull request's diff could not be read.
#[derive(Debug, thiserror::Error)]
pub enum GithubPullRequestDiffError {
    /// GitHub cannot find the pull request.
    #[error("the pull request does not exist on GitHub")]
    NotFound,
    /// GitHub refuses to render a diff this large.
    #[error("the diff is too large for GitHub to render")]
    TooLarge,
    /// The caller may not reach the repository through the GitHub App.
    #[error("the repository is not reachable through the configured GitHub App")]
    Unavailable,
    /// Anything else.
    #[error(transparent)]
    Other(anyhow::Error),
}

impl GithubPullRequestDiffError {
    /// What a user can do about GitHub refusing the diff, in a sentence; `None` for failures
    /// that are not theirs to fix.
    #[must_use]
    pub fn user_message(&self) -> Option<&'static str> {
        match self {
            Self::NotFound => Some("This pull request is not available on GitHub."),
            Self::TooLarge => {
                Some("This pull request is too large to load here. Review it on GitHub.")
            }
            Self::Unavailable => Some(
                "Macro's GitHub App cannot read this pull request. Check its repository access.",
            ),
            Self::Other(_) => None,
        }
    }
}

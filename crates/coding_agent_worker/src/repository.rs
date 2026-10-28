//! Repository identity and the policy for preparing a fresh session checkout.

use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

/// A remote repository, normalized independently of its HTTPS/SSH transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repository {
    /// URL used when a clone does not exist yet.
    pub url: String,
    /// Host and repository path, safe as a relative cache directory.
    pub key: String,
}

impl Repository {
    /// Accept HTTPS or SSH remotes, excluding credentials and local Git transports.
    pub fn parse(input: &str) -> rootcause::Result<Self> {
        let input = input.trim();
        let url = if let Some(ssh) = input.strip_prefix("git@") {
            let (host, path) = ssh
                .split_once(':')
                .ok_or_else(|| rootcause::report!("invalid SSH repository"))?;
            format!("ssh://git@{host}/{path}")
        } else if input.starts_with("github.com/") {
            format!("https://{input}")
        } else {
            input.to_owned()
        };
        let parsed = reqwest::Url::parse(&url)?;
        if !matches!(parsed.scheme(), "https" | "ssh")
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.port().is_some()
            || (parsed.scheme() == "https" && !parsed.username().is_empty())
            || (parsed.scheme() == "ssh" && parsed.username() != "git")
        {
            rootcause::bail!("use an HTTPS or git@host repository URL without credentials");
        }
        let host = parsed
            .host_str()
            .ok_or_else(|| rootcause::report!("repository host is missing"))?;
        let path = parsed.path().trim_matches('/').trim_end_matches(".git");
        if path.is_empty()
            || !path.split('/').all(|part| {
                !part.is_empty()
                    && part != "."
                    && part != ".."
                    && part
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
            })
        {
            rootcause::bail!("invalid repository path");
        }
        Ok(Self {
            url,
            key: format!("{host}/{path}"),
        })
    }
}

/// Git operations needed to prepare a repository without changing its working tree.
pub trait RepositoryStore {
    /// Find a clone with the same origin among the configured search roots.
    fn find(
        &self,
        repository: &Repository,
    ) -> impl Future<Output = rootcause::Result<Option<PathBuf>>> + Send;
    /// Clone into the private repository cache, returning its path.
    fn clone_repository(
        &self,
        repository: &Repository,
    ) -> impl Future<Output = rootcause::Result<PathBuf>> + Send;
    /// Fetch the latest origin/main, failing when the remote has no main branch.
    fn refresh_main(&self, path: &Path) -> impl Future<Output = rootcause::Result<()>> + Send;
}

/// Resolve a clone and refresh the base before Herdr creates a new worktree.
pub async fn prepare(
    store: &impl RepositoryStore,
    repository: &Repository,
) -> rootcause::Result<PathBuf> {
    let path = match store.find(repository).await? {
        Some(path) => path,
        None => store.clone_repository(repository).await?,
    };
    store.refresh_main(&path).await?;
    Ok(path)
}

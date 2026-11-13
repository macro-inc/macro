//! Which repository an event belongs to, and whether it is accepted.

use url::Url;

use super::models::ALLOWED_REPOSITORIES;

#[cfg(test)]
mod test;

/// Where an event's repository falls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryScope {
    /// An allowed repository, normalized to `host/owner/name`.
    Allowed(String),
    /// A repository outside the allowlist (or an unparseable URL).
    Other,
    /// The event names no repository.
    Missing,
}

impl RepositoryScope {
    /// Classifies an event's `repo_url` attribute.
    pub fn of(repo_url: Option<&str>) -> Self {
        let Some(repo_url) = repo_url else {
            return Self::Missing;
        };
        match normalize_repository_url(repo_url) {
            Some(repository) if ALLOWED_REPOSITORIES.contains(&repository.as_str()) => {
                Self::Allowed(repository)
            }
            _ => Self::Other,
        }
    }
}

/// `host/owner/name` in lowercase for the remote URL forms git accepts:
/// `https://host/owner/name(.git)`, `ssh://git@host/owner/name`, and the scp
/// form `git@host:owner/name.git`. Credentials, ports, a trailing slash and
/// the `.git` suffix are dropped. `None` when it is not a remote URL.
pub fn normalize_repository_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let url = match Url::parse(raw) {
        Ok(url) => url,
        // The scp form has no scheme: `user@host:path`.
        Err(_) => {
            let (user_and_host, path) = raw.split_once(':')?;
            Url::parse(&format!("ssh://{user_and_host}/{path}")).ok()?
        }
    };
    if !matches!(url.scheme(), "https" | "http" | "ssh" | "git" | "git+ssh") {
        return None;
    }

    let host = url.host_str()?.to_lowercase();
    let path = url.path().trim_matches('/').to_lowercase();
    let path = path.strip_suffix(".git").unwrap_or(&path);
    let segments: Vec<&str> = path.split('/').collect();
    match segments.as_slice() {
        [owner, name] if !owner.is_empty() && !name.is_empty() => {
            Some(format!("{host}/{owner}/{name}"))
        }
        _ => None,
    }
}

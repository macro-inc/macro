//! Git credentials for the session's repository.
//!
//! The minting itself - proving we are the App, finding the installation,
//! checking it belongs to the session's owner, cutting the token down to one
//! repository - belongs to the `github` crate, which owns everything else we
//! know about GitHub. This adapter asks for a token, says which permissions a
//! coding agent needs, and turns the answer into something the proxy can stamp.
//!
//! What it adds on top is a cache. A token is good for an hour and a clone can
//! be issued many times over a session's life, so re-minting per request would
//! spend rate limit for nothing.

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use dashmap::DashMap;
use github::domain::models::GithubError;
use github::domain::ports::{GithubSyncClient, GithubSyncRepo};
use github::domain::service::InstallationTokenService;
use macro_user_id::user_id::MacroUserIdStr;
use url::Url;

use crate::domain::error::EgressError;
use crate::domain::model::{RepoSlug, UpstreamCall};
use crate::domain::ports::GithubTokens;

#[cfg(test)]
mod test;

/// The git base every repository URL is built from.
///
/// A hardcoded constant, and that is load-bearing rather than incidental. The
/// repository comes from `grant.repo`, which comes from claims we signed
/// ourselves, and `RepoSlug::parse` excludes every character that could rewrite
/// a URL's host or path. Together with this constant, the destination of a
/// stamped git request cannot be anything but the session's own repository on
/// GitHub - which is why there is no separate check that it is.
///
/// Do not make this configuration. Moving it into an env var moves the
/// guarantee above into whatever sets that env var.
const GITHUB_GIT_BASE: &str = "https://github.com";

/// The username half of git's Basic auth. GitHub ignores it, but git's
/// credential protocol has nowhere to put a token except the password, so
/// something has to go here; this is the value GitHub documents.
const GIT_BASIC_USERNAME: &str = "x-access-token";

/// What a coding agent working a pull request needs, and no more: read and
/// write the code, open and comment on pull requests, read the repository's own
/// metadata. Notably absent is anything that changes repository settings.
const AGENT_PERMISSIONS: &[(&str, &str)] = &[
    ("contents", "write"),
    ("pull_requests", "write"),
    ("metadata", "read"),
];

/// How long before expiry a cached token stops being handed out.
///
/// A packfile transfer can take minutes, and a token that expires mid-transfer
/// fails the whole clone.
const EXPIRY_MARGIN_MINUTES: i64 = 5;

/// Hands out git credentials, caching each until it is nearly stale.
pub struct GithubAppTokens<Installations, Client> {
    tokens: InstallationTokenService<Installations, Client>,
    /// Keyed by repository *and* owner: a cached token must never stand in for
    /// an ownership check that did not happen for this user.
    cached: DashMap<(MacroUserIdStr<'static>, RepoSlug), CachedToken>,
}

#[derive(Clone)]
struct CachedToken {
    token: String,
    expires_at: DateTime<Utc>,
}

impl<Installations, Client> GithubAppTokens<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    /// Wrap the `github` crate's minting service with a cache.
    pub fn new(tokens: InstallationTokenService<Installations, Client>) -> Self {
        Self {
            tokens,
            cached: DashMap::new(),
        }
    }

    async fn token(
        &self,
        owner: &MacroUserIdStr<'static>,
        repo: &RepoSlug,
    ) -> Result<String, EgressError> {
        let key = (owner.clone(), repo.clone());

        if let Some(cached) = usable(self.cached.get(&key).map(|entry| entry.clone())) {
            return Ok(cached.token);
        }

        let minted = self
            .tokens
            .for_repository(owner, repo.owner(), repo.name(), AGENT_PERMISSIONS)
            .await
            .map_err(|error| match error {
                GithubError::RepositoryUnavailable => EgressError::RepoUnavailable(repo.clone()),
                other => EgressError::Upstream(rootcause::report!(
                    "could not mint a github token: {other}"
                )),
            })?;

        let expires_at = minted
            .expires_at()
            .map_err(|error| EgressError::Upstream(rootcause::report!("{error}")))?;

        self.cached.insert(
            key,
            CachedToken {
                token: minted.token.clone(),
                expires_at,
            },
        );

        Ok(minted.token)
    }
}

impl<Installations, Client> GithubTokens for GithubAppTokens<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    #[tracing::instrument(skip_all, err, fields(%owner, %repo))]
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        repo: &RepoSlug,
    ) -> Result<UpstreamCall, EgressError> {
        let token = self.token(owner, repo).await?;

        // Trailing slash: the domain appends the git endpoint to this, and a
        // URL join replaces the last segment rather than extending it without
        // one.
        let url = Url::parse(&format!(
            "{GITHUB_GIT_BASE}/{}/{}.git/",
            repo.owner(),
            repo.name()
        ))
        .map_err(|error| {
            EgressError::Internal(rootcause::report!("repository url is not a url: {error}"))
        })?;

        UpstreamCall::basic(url, GIT_BASIC_USERNAME, token)
    }
}

/// A cached token, if it will still be valid long enough to be worth using.
fn usable(cached: Option<CachedToken>) -> Option<CachedToken> {
    let cached = cached?;
    let deadline = Utc::now() + ChronoDuration::minutes(EXPIRY_MARGIN_MINUTES);
    (cached.expires_at > deadline).then_some(cached)
}

//! The branches on a repository a user reaches through Macro's GitHub App.
//!
//! Reachability is the `github` crate's question: this adapter only maps its
//! answer into the harness's vocabulary so a picker can list the same branches
//! a session may start on.

use github::domain::models::GithubError;
use github::domain::ports::{GithubSyncClient, GithubSyncRepo};
use github::domain::service::InstallationTokenService;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::RepositoryBranches;

/// [`RepositoryBranches`] backed by a scoped installation token.
pub struct GithubRepositoryBranches<Installations, Client> {
    tokens: InstallationTokenService<Installations, Client>,
}

impl<Installations, Client> GithubRepositoryBranches<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    /// Wrap the token service that already proves the user reaches the
    /// repository before talking to GitHub.
    pub fn new(tokens: InstallationTokenService<Installations, Client>) -> Self {
        Self { tokens }
    }
}

#[async_trait::async_trait]
impl<Installations, Client> RepositoryBranches for GithubRepositoryBranches<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    async fn for_repository(
        &self,
        user: &MacroUserIdStr<'_>,
        owner: &str,
        name: &str,
    ) -> Result<Vec<String>> {
        match self.tokens.branches_for_repository(user, owner, name).await {
            Ok(branches) => Ok(branches),
            Err(GithubError::RepositoryUnavailable) => Err(HarnessError::RepositoryUnavailable),
            Err(error) => Err(HarnessError::Repositories(rootcause::report!("{error}"))),
        }
    }
}

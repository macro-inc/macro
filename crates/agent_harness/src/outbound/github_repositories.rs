//! The repositories a user reaches through Macro's GitHub App.
//!
//! Everything this knows about GitHub - which installations belong to whom,
//! what each one covers, how to prove we are the App - belongs to the `github`
//! crate. This adapter only narrows its answer to what the harness asked for:
//! a list of repository urls for one user.

use github::domain::ports::{GithubSyncClient, GithubSyncRepo};
use github::domain::service::ReachableRepositoriesService;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::ReachableRepositories;

/// [`ReachableRepositories`] backed by the `github` crate's listing service.
pub struct GithubReachableRepositories<Installations, Client> {
    repositories: ReachableRepositoriesService<Installations, Client>,
}

impl<Installations, Client> GithubReachableRepositories<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    /// Wrap the `github` crate's listing service.
    pub fn new(repositories: ReachableRepositoriesService<Installations, Client>) -> Self {
        Self { repositories }
    }
}

impl<Installations, Client> ReachableRepositories
    for GithubReachableRepositories<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    async fn for_user(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<String>> {
        let repositories = self
            .repositories
            .for_user(user)
            .await
            .map_err(|error| HarnessError::Repositories(rootcause::report!("{error}")))?;
        // The canonical url, derived rather than GitHub's `html_url`: it is
        // what Cursor is given and what the session row is pinned to, and both
        // must agree with what the model was offered.
        Ok(repositories
            .iter()
            .map(github::domain::models::GithubRepository::https_url)
            .collect())
    }
}

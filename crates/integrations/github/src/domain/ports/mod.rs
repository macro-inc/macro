//! Port definitions for the github domain.
//!
//! These traits define the contracts that adapters must implement.

#[cfg(feature = "installation_claims")]
mod installation_claims;
#[cfg(feature = "link")]
mod link;
#[cfg(feature = "sync")]
mod sync;

#[cfg(feature = "installation_claims")]
pub use installation_claims::GithubInstallationClaims;
#[cfg(feature = "link")]
pub use link::{Auth, GithubLinkService, GithubOauth, GithubRepo};
#[cfg(all(test, feature = "sync"))]
pub use sync::MockGithubSyncRepo;
#[cfg(feature = "sync")]
pub use sync::{
    GithubInstallationLister, GithubPullRequestIndex, GithubRepositoryClient, GithubSyncClient,
    GithubSyncRealtime, GithubSyncRepo, GithubSyncService, GithubWebhookPublisher,
};

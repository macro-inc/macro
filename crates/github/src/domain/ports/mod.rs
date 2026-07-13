//! Port definitions for the github domain.
//!
//! These traits define the contracts that adapters must implement.

#[cfg(feature = "link")]
mod link;
#[cfg(feature = "sync")]
mod sync;

#[cfg(feature = "link")]
pub use link::{Auth, GithubLinkService, GithubOauth, GithubRepo};
#[cfg(feature = "sync")]
pub use sync::{GithubSyncClient, GithubSyncRepo, GithubSyncService};

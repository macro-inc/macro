//! Outbound adapters for the github domain.

#[cfg(feature = "link")]
pub mod github_auth_client;
#[cfg(feature = "link")]
pub mod github_oauth_client;
#[cfg(feature = "sync")]
pub mod github_sync_client;
#[cfg(feature = "link")]
pub mod pg_github_repo;
#[cfg(feature = "sync")]
pub mod pg_github_sync_repo;
#[cfg(any(feature = "link", feature = "sync"))]
pub(crate) mod pull_request_metadata;

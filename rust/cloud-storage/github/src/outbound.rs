//! Outbound adapters for the github domain.

#[cfg(feature = "link")]
pub mod github_auth_client;
#[cfg(feature = "link")]
pub mod github_oauth_client;
#[cfg(feature = "sync")]
pub mod github_sync_client;
#[cfg(feature = "link")]
pub mod pg_github_repo;

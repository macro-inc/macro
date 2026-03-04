//! Outbound adapters for the github domain.

#[cfg(feature = "link")]
pub mod github_auth_client;
#[cfg(feature = "link")]
pub mod github_oauth_client;
#[cfg(feature = "link")]
pub mod pg_github_repo;

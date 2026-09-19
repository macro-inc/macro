//! Github service implementation.

#[cfg(feature = "sync")]
mod installation_tokens;
#[cfg(feature = "sync")]
mod sync;

#[cfg(feature = "sync")]
pub use installation_tokens::{InstallationTokenConfig, InstallationTokenService};
#[cfg(feature = "sync")]
pub use sync::{GithubSyncConfig, GithubSyncServiceImpl};
#[cfg(feature = "link")]
mod link;

#[cfg(feature = "link")]
pub use link::{GithubLinkConfig, GithubLinkServiceImpl};

#[cfg(all(test, feature = "link"))]
mod link_test;

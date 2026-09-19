//! Sandboxes on the local Docker daemon, for developing against the real
//! image without a Daytona account.

mod docker;
mod errors;
mod manager;

pub use errors::LocalError;
pub use manager::{LocalContainerManager, LocalSettings};

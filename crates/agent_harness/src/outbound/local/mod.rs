//! Sandboxes on the local Docker daemon, for developing against the real
//! harness image.

mod docker;
mod errors;
mod manager;

pub use errors::LocalError;
pub use manager::{AnthropicApiKey, LocalContainerManager, LocalSettings};

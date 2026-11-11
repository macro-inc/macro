//! Validated bootstrap credentials shared by agent provisioning, git and gateways.
#![deny(missing_docs)]

mod api_key;
mod repo_token;

pub use api_key::AgentApiKey;
pub use repo_token::{RepoToken, RepoTokenHash};

/// A credential did not match the service's fixed prefix and random-secret shape.
/// The error deliberately never includes the supplied credential.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("invalid agent credential")]
pub struct InvalidAgentCredential;

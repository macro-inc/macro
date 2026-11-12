//! Validated bootstrap credentials shared by agent provisioning, git and gateways.
#![deny(missing_docs)]

mod api_key;
mod repo_token;

pub use api_key::AgentApiKey;
pub use repo_token::{RepoToken, RepoTokenHash};

/// The rollout key for agent teammates, evaluated per user and fail-closed
/// wherever an agent teammate surface is served.
pub const AGENT_TEAMMATES_FLAG: &str = "enable-agent-teammates";

/// A credential did not match the service's fixed prefix and random-secret shape.
/// The error deliberately never includes the supplied credential.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("invalid agent credential")]
pub struct InvalidAgentCredential;

/// SHA-256 of an agent's user id (lowercase hex), for telemetry and repository
/// directory names, where the email-bearing `macro|<email>` id must not appear.
pub fn telemetry_id(user_id: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(user_id.as_bytes()))
}

//! Domain models for agent secrets.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// Largest secret value, in bytes: KMS's direct-encrypt limit.
pub const MAX_SECRET_BYTES: usize = 4096;

/// A secret's name: lowercase letters, digits, `_`, `-` and `.`, 1 to 64
/// characters, starting with a letter or digit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretName(String);

impl SecretName {
    /// Accept a name, checking its shape.
    pub fn parse(raw: &str) -> Result<Self, AgentSecretError> {
        if lazy_regex::regex_is_match!(r"\A[a-z0-9][a-z0-9_.-]{0,63}\z", raw) {
            Ok(Self(raw.to_string()))
        } else {
            Err(AgentSecretError::BadRequest(
                "a secret name is 1 to 64 lowercase letters, digits, '_', '-' or '.'".to_string(),
            ))
        }
    }

    /// The name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A secret's plaintext. Redacts its `Debug` and zeroizes on drop.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretValue(Zeroizing<String>);

impl SecretValue {
    /// Accept a value, checking its size.
    pub fn parse(raw: String) -> Result<Self, AgentSecretError> {
        if raw.is_empty() || raw.len() > MAX_SECRET_BYTES {
            return Err(AgentSecretError::BadRequest(format!(
                "a secret value is 1 to {MAX_SECRET_BYTES} bytes"
            )));
        }

        Ok(Self(Zeroizing::new(raw)))
    }

    /// The plaintext, for KMS or the agent's own response only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SecretValue {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretValue(redacted)")
    }
}

/// A KMS ciphertext and how to decrypt it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedSecret {
    /// The KMS ciphertext blob.
    pub ciphertext: Vec<u8>,
    /// The scheme that produced it.
    pub encryption_version: i16,
    /// The KMS key that encrypted it.
    pub kms_key_id: String,
}

/// A stored secret, still encrypted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSecret {
    /// The secret's name.
    pub name: String,
    /// The ciphertext.
    pub encrypted: EncryptedSecret,
    /// When it was first stored.
    pub created_at: DateTime<Utc>,
    /// When it was last replaced.
    pub updated_at: DateTime<Utc>,
}

/// Body of `PUT /team_agents/me/secrets/{name}`.
#[derive(Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PutAgentSecret {
    /// The secret's value, 1 to 4096 bytes.
    pub value: String,
}

impl std::fmt::Debug for PutAgentSecret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PutAgentSecret(redacted)")
    }
}

/// A secret's name and timestamps, without its value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentSecretSummary {
    /// The secret's name.
    pub name: String,
    /// When it was first stored.
    pub created_at: DateTime<Utc>,
    /// When it was last replaced.
    pub updated_at: DateTime<Utc>,
}

/// An agent's secrets, by name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentSecretSummaries {
    /// The secrets, by name.
    pub secrets: Vec<AgentSecretSummary>,
}

/// A secret with its value, for the agent that owns it.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentSecret {
    /// The secret's name.
    pub name: String,
    /// The plaintext value.
    pub value: String,
    /// When it was last replaced.
    pub updated_at: DateTime<Utc>,
}

impl std::fmt::Debug for AgentSecret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AgentSecret")
            .field("name", &self.name)
            .field("updated_at", &self.updated_at)
            .finish_non_exhaustive()
    }
}

/// Errors from agent secret operations.
#[derive(Debug, thiserror::Error)]
pub enum AgentSecretError {
    /// The request is malformed.
    #[error("{0}")]
    BadRequest(String),
    /// The caller is not a team agent.
    #[error("the caller is not a team agent")]
    NotAnAgent,
    /// No such secret, or no such agent on the caller's team.
    #[error("not found")]
    NotFound,
    /// Anything else, KMS included. Opaque on purpose: KMS errors can tell a
    /// wrong encryption context from a missing permission.
    #[error("internal error: {0}")]
    Internal(rootcause::Report),
}

impl AgentSecretError {
    /// Wrap an adapter error as internal.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}

//! Domain models for agent secrets.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[cfg(test)]
mod test;

/// Largest secret value, in bytes: KMS's direct-encrypt limit.
pub const MAX_SECRET_BYTES: usize = 4096;

/// A secret's name: lowercase letters, digits, `_`, `-` and `.`, 1 to 64
/// characters, starting with a letter or digit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
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

impl<'de> Deserialize<'de> for SecretName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
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

impl Serialize for SecretValue {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.expose())
    }
}

impl<'de> Deserialize<'de> for SecretValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl std::fmt::Debug for SecretValue {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretValue(redacted)")
    }
}

/// A KMS key identifier, alias, or ARN. Keep provider identifiers bounded and
/// free of whitespace/control characters before passing them back to KMS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct KmsKeyId(String);

impl KmsKeyId {
    /// Validate the character set shared by KMS key IDs, aliases and ARNs.
    pub fn parse(raw: String) -> Result<Self, InvalidKmsKeyId> {
        if !lazy_regex::regex_is_match!(r"^[A-Za-z0-9:/_.-]{1,2048}$", &raw) {
            return Err(InvalidKmsKeyId);
        }
        Ok(Self(raw))
    }

    /// The provider's identifier, for storage and KMS calls.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A malformed key identifier; errors never include the supplied value.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("invalid KMS key identifier")]
pub struct InvalidKmsKeyId;

impl TryFrom<String> for KmsKeyId {
    type Error = InvalidKmsKeyId;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(raw)
    }
}

impl From<KmsKeyId> for String {
    fn from(key: KmsKeyId) -> Self {
        key.0
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
    pub kms_key_id: KmsKeyId,
}

/// A stored secret, still encrypted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSecret {
    /// The secret's name.
    pub name: SecretName,
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
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub name: SecretName,
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
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub name: SecretName,
    /// The plaintext value.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub value: SecretValue,
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
    /// The administrative team-agent feature is not enabled for this caller.
    #[error("team agents aren't available for this account yet")]
    NotEnabled,
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

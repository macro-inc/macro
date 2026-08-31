//! Domain models for user API keys.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Prefix written onto every newly minted key, and onto display prefixes.
pub const KEY_PREFIX: &str = "mak_";

/// Entropy used when minting a key (32 bytes → 64 hex characters).
const KEY_SECRET_BYTES: usize = 32;

/// Hex characters of the SHA-256 digest used as the public display prefix.
const DISPLAY_PREFIX_HEX_CHARS: usize = 8;

/// Opaque identifier for a stored user API key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(transparent)]
pub struct UserApiKeyId(Uuid);

impl UserApiKeyId {
    /// Mint a new UUIDv7 identifier.
    pub fn generate() -> Self {
        Self(Uuid::now_v7())
    }

    /// Wrap an already-persisted id.
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The inner UUID.
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl fmt::Display for UserApiKeyId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for UserApiKeyId {
    type Err = uuid::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

/// A user API key secret.
///
/// [`Debug`] redacts to `mak_…` plus the last four characters so
/// `#[tracing::instrument]` cannot leak the full secret.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserApiKey(String);

impl UserApiKey {
    /// Mint a new `mak_` + 64-hex-character key from OS CSPRNG bytes.
    pub fn generate() -> Self {
        let mut secret = [0_u8; KEY_SECRET_BYTES];
        rand::rng().fill_bytes(&mut secret);
        Self(format!("{KEY_PREFIX}{}", hex::encode(secret)))
    }

    /// Wrap an already-persisted or caller-supplied secret.
    ///
    /// Does not validate format: legacy rows may predate the `mak_` prefix.
    pub fn from_raw(raw: impl Into<String>) -> Self {
        Self(raw.into())
    }

    /// The only way to read the full secret.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Public display prefix derived from the secret.
    ///
    /// Uses the first eight hex characters of SHA-256 so the value is never a
    /// raw substring of the secret.
    pub fn display_prefix(&self) -> String {
        let digest = Sha256::digest(self.0.as_bytes());
        format!(
            "{KEY_PREFIX}{}",
            hex::encode(&digest[..DISPLAY_PREFIX_HEX_CHARS / 2])
        )
    }
}

impl AsRef<str> for UserApiKey {
    fn as_ref(&self) -> &str {
        self.expose()
    }
}

impl fmt::Debug for UserApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let raw = self.expose();
        let suffix = raw.get(raw.len().saturating_sub(4)..).unwrap_or("");
        write!(f, "mak_…{suffix}")
    }
}

/// Safe metadata for a stored key. Never contains the secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UserApiKeyInfo {
    /// Opaque identifier used to address the key after create.
    pub id: UserApiKeyId,
    /// Public display prefix; not a substring of the secret.
    pub prefix: String,
    /// When the key was created.
    pub created_at: DateTime<Utc>,
}

/// A newly minted key: safe metadata plus the secret, shown only once.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreatedUserApiKey {
    /// Opaque identifier used to address the key after create.
    pub id: UserApiKeyId,
    /// Public display prefix; not a substring of the secret.
    pub prefix: String,
    /// When the key was created.
    pub created_at: DateTime<Utc>,
    /// The newly minted secret. Shown only on create.
    pub key: String,
}

impl fmt::Debug for CreatedUserApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CreatedUserApiKey")
            .field("id", &self.id)
            .field("prefix", &self.prefix)
            .field("created_at", &self.created_at)
            .field("key", &UserApiKey::from_raw(&self.key))
            .finish()
    }
}

impl CreatedUserApiKey {
    /// Build a create response from persisted metadata and the raw secret.
    pub fn new(info: UserApiKeyInfo, key: &UserApiKey) -> Self {
        Self {
            id: info.id,
            prefix: info.prefix,
            created_at: info.created_at,
            key: key.expose().to_string(),
        }
    }
}

/// Errors returned by the user API key service.
#[derive(Debug, thiserror::Error)]
pub enum UserApiKeyError {
    /// The key does not exist in the caller's collection.
    #[error("api key not found")]
    NotFound,
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// Any other internal error.
    #[error("internal user api key error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for UserApiKeyError {
    fn from(report: rootcause::Report) -> Self {
        UserApiKeyError::Internal(report)
    }
}

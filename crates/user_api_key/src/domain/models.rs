//! Domain models for user API keys.

use std::fmt;

use rand::RngCore;
use serde::{Deserialize, Serialize};

/// Prefix written onto every newly minted key.
pub const KEY_PREFIX: &str = "mak_";

/// Entropy used when minting a key (32 bytes → 64 hex characters).
const KEY_SECRET_BYTES: usize = 32;

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

use std::fmt;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::InvalidAgentCredential;

const TOKEN_PREFIX: &str = "mrt_";
const TOKEN_SECRET_BYTES: usize = 32;

/// A random repo-scoped HTTP Basic password. Debug never reveals the secret.
#[derive(Clone, Deserialize)]
#[serde(try_from = "String")]
pub struct RepoToken(Zeroizing<String>);

impl RepoToken {
    /// Mint a token using the service's existing 256-bit random-secret format.
    pub fn generate() -> Self {
        let mut secret = Zeroizing::new([0_u8; TOKEN_SECRET_BYTES]);
        rand::rng().fill_bytes(&mut *secret);
        Self(Zeroizing::new(format!(
            "{TOKEN_PREFIX}{}",
            hex::encode(*secret)
        )))
    }

    /// Validate a presented, returned or saved token at its boundary.
    pub fn parse(raw: String) -> Result<Self, InvalidAgentCredential> {
        let raw = Zeroizing::new(raw);
        if !lazy_regex::regex_is_match!(r"^mrt_[0-9a-f]{64}$", raw.as_str()) {
            return Err(InvalidAgentCredential);
        }
        Ok(Self(raw))
    }

    /// Read the secret only for authentication or bootstrap configuration.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// SHA-256 of the token, for storage. Random tokens need no password KDF.
    pub fn hash(&self) -> RepoTokenHash {
        RepoTokenHash(hex::encode(Sha256::digest(self.0.as_bytes())))
    }
}

impl TryFrom<String> for RepoToken {
    type Error = InvalidAgentCredential;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(raw)
    }
}

impl Serialize for RepoToken {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.expose())
    }
}

impl PartialEq for RepoToken {
    fn eq(&self, other: &Self) -> bool {
        constant_time_eq::constant_time_eq(self.0.as_bytes(), other.0.as_bytes())
    }
}

impl Eq for RepoToken {}

impl fmt::Debug for RepoToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RepoToken(redacted)")
    }
}

/// A validated hex SHA-256 token digest, with redacted Debug and constant-time Eq.
#[derive(Clone, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RepoTokenHash(String);

impl RepoTokenHash {
    /// Validate an existing stored digest; invalid rows never become credentials.
    pub fn from_stored(raw: String) -> Result<Self, InvalidAgentCredential> {
        if !lazy_regex::regex_is_match!(r"^[0-9a-f]{64}$", &raw) {
            return Err(InvalidAgentCredential);
        }
        Ok(Self(raw))
    }

    /// The digest for persistence only.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Compare digests in constant time, including when using ordinary equality.
    pub fn matches(&self, other: &Self) -> bool {
        self == other
    }
}

impl TryFrom<String> for RepoTokenHash {
    type Error = InvalidAgentCredential;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::from_stored(raw)
    }
}

impl From<RepoTokenHash> for String {
    fn from(hash: RepoTokenHash) -> Self {
        hash.0
    }
}

impl PartialEq for RepoTokenHash {
    fn eq(&self, other: &Self) -> bool {
        constant_time_eq::constant_time_eq(self.0.as_bytes(), other.0.as_bytes())
    }
}

impl Eq for RepoTokenHash {}

impl fmt::Debug for RepoTokenHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RepoTokenHash(redacted)")
    }
}

#[cfg(test)]
mod test;

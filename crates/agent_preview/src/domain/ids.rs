//! The routing identity of one preview.

use super::PreviewError;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Length of a routing ID in characters, and so of its DNS label.
const LENGTH: usize = 32;

/// A preview's public routing ID: one DNS label, never an authorization credential.
///
/// Distinct from the agent session that owns the preview. Both reach this crate
/// as user-supplied strings - one in a `Host` header, one in an entity access
/// receipt - and the registry is keyed by the session while credentials point at
/// the preview, so the two must not be interchangeable.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct PreviewId(String);

impl PreviewId {
    /// Mint an unguessable ID.
    ///
    /// DNS labels are case insensitive, so the 256-bit seed is rendered as hex:
    /// unambiguous, and still 128 bits wide.
    #[must_use]
    pub fn generate() -> Self {
        let mut seed = [0u8; 32];
        rand::rng().fill_bytes(&mut seed);
        let digest: [u8; 32] = Sha256::digest(URL_SAFE_NO_PAD.encode(seed).as_bytes()).into();
        Self(
            digest[..LENGTH / 2]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        )
    }

    /// Accept a routing ID from a request, rejecting anything not of this shape.
    pub fn parse(value: &str) -> Result<Self, PreviewError> {
        if value.len() != LENGTH || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(PreviewError::Invalid);
        }
        Ok(Self(value.to_ascii_lowercase()))
    }
}

impl std::fmt::Display for PreviewId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

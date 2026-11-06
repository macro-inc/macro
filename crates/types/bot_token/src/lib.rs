//! Hash and display-prefix helpers for bot bearer tokens.
//!
//! Mint (`bots`) and auth-time lookup (`macro_authorization`) both persist or
//! match `token_hash`. This crate owns that digest so the two sides cannot
//! drift, without either crate depending on the other.

#![deny(missing_docs)]

use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

/// Number of characters used as a fallback display prefix.
const FALLBACK_PREFIX_CHARS: usize = 12;

/// SHA-256 of a raw bot bearer token's UTF-8 bytes.
pub fn hash_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Display prefix for a bot bearer token.
///
/// Current tokens look like `mbot_<hex>_<secret>`. The displayed prefix is
/// `mbot_<hex>`. Tokens that do not match that shape use the first 12 hex
/// characters of the SHA-256, never a raw substring of the secret.
pub fn token_prefix(token: &str) -> String {
    if let Some(rest) = token.strip_prefix("mbot_")
        && let Some((prefix, _)) = rest.split_once('_')
        && !prefix.is_empty()
    {
        return format!("mbot_{prefix}");
    }
    fallback_prefix(token)
}

fn fallback_prefix(token: &str) -> String {
    hash_token(token)
        .into_iter()
        .take(FALLBACK_PREFIX_CHARS / 2)
        .fold(
            String::with_capacity(FALLBACK_PREFIX_CHARS),
            |mut out, byte| {
                use std::fmt::Write;
                let _ = write!(out, "{byte:02x}");
                out
            },
        )
}

/// Hash and display prefix derived from a raw bot bearer token.
///
/// Persist this. Never persist the raw secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashedBotToken {
    /// SHA-256 of the raw token UTF-8 bytes.
    pub hash: [u8; 32],
    /// Display prefix (`mbot_<hex>` or a hash-derived fallback).
    pub prefix: String,
}

impl HashedBotToken {
    /// Hash a raw bearer token for storage.
    pub fn from_raw(token: &str) -> Self {
        Self {
            hash: hash_token(token),
            prefix: token_prefix(token),
        }
    }
}

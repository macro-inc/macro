//! Hash and display-prefix helpers for Macro-minted bearer tokens.
//!
//! Minting (`bots`, `harnesses`) and auth-time lookup (`macro_authorization`)
//! both persist or match `token_hash`. This crate owns that digest so the two
//! sides cannot drift, without either crate depending on the other.
//!
//! Each kind of token is a [`TokenFamily`] with its own display prefix. The
//! family is a type parameter, so a bot token's hash cannot be stored where a
//! harness token's hash is expected.

#![deny(missing_docs)]

use std::marker::PhantomData;

use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

/// Number of characters used as a fallback display prefix.
const FALLBACK_PREFIX_CHARS: usize = 12;

/// A kind of bearer token, identified by the prefix of its raw form.
pub trait TokenFamily {
    /// The leading segment of a raw token, without the trailing `_`.
    const PREFIX: &'static str;
}

/// Bot bearer tokens: `mbot_<hex>_<secret>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bot {}

impl TokenFamily for Bot {
    const PREFIX: &'static str = "mbot";
}

/// Harness bearer tokens: `mhns_<hex>_<secret>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Harness {}

impl TokenFamily for Harness {
    const PREFIX: &'static str = "mhns";
}

/// SHA-256 of a raw bearer token's UTF-8 bytes.
pub fn hash_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Display prefix for a bearer token of family `F`.
///
/// Tokens shaped `<PREFIX>_<hex>_<secret>` display as `<PREFIX>_<hex>`. Tokens
/// of any other shape use the first 12 hex characters of the SHA-256, never a
/// raw substring of the secret.
pub fn token_prefix<F: TokenFamily>(token: &str) -> String {
    if let Some(rest) = token
        .strip_prefix(F::PREFIX)
        .and_then(|rest| rest.strip_prefix('_'))
        && let Some((prefix, _)) = rest.split_once('_')
        && !prefix.is_empty()
    {
        return format!("{}_{prefix}", F::PREFIX);
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

/// Hash and display prefix derived from a raw bearer token of family `F`.
///
/// Persist this. Never persist the raw secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashedBearerToken<F: TokenFamily> {
    /// SHA-256 of the raw token UTF-8 bytes.
    pub hash: [u8; 32],
    /// Display prefix (`<PREFIX>_<hex>` or a hash-derived fallback).
    pub prefix: String,
    family: PhantomData<F>,
}

impl<F: TokenFamily> HashedBearerToken<F> {
    /// Hash a raw bearer token for storage.
    pub fn from_raw(token: &str) -> Self {
        Self {
            hash: hash_token(token),
            prefix: token_prefix::<F>(token),
            family: PhantomData,
        }
    }
}

/// A hashed bot bearer token.
pub type HashedBotToken = HashedBearerToken<Bot>;

/// A hashed harness bearer token.
pub type HashedHarnessToken = HashedBearerToken<Harness>;

//! Bot token generation and verification utilities.

use rand::RngCore;
use sha2::{Digest, Sha256};

const TOKEN_SECRET_BYTES: usize = 32;
const TOKEN_PREFIX_BYTES: usize = 6;

/// Generated raw token plus lookup prefix and hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedBotToken {
    /// Raw bearer token.
    pub token: String,
    /// Lookup prefix.
    pub prefix: String,
    /// SHA-256 hash bytes.
    pub hash: Vec<u8>,
}

/// Generate an `mbot_<prefix>_<secret>` token.
pub fn generate_token() -> GeneratedBotToken {
    let mut secret = [0_u8; TOKEN_SECRET_BYTES];
    rand::rng().fill_bytes(&mut secret);
    let secret_hex = hex::encode(secret);
    let prefix = secret_hex[..TOKEN_PREFIX_BYTES * 2].to_string();
    let token = format!("mbot_{prefix}_{secret_hex}");
    let hash = hash_token(&token);
    GeneratedBotToken {
        token,
        prefix,
        hash,
    }
}

/// Extract the lookup prefix from a raw bot token.
pub fn token_prefix(token: &str) -> Option<&str> {
    let mut parts = token.splitn(3, '_');
    match (parts.next(), parts.next(), parts.next()) {
        (Some("mbot"), Some(prefix), Some(secret)) if !prefix.is_empty() && !secret.is_empty() => {
            Some(prefix)
        }
        _ => None,
    }
}

/// SHA-256 hash a token.
pub fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Constant-time equality for token hashes.
pub fn verify_hash(expected: &[u8], actual: &[u8]) -> bool {
    if expected.len() != actual.len() {
        return false;
    }
    expected
        .iter()
        .zip(actual.iter())
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_has_prefix_and_hash() {
        let generated = generate_token();

        assert!(generated.token.starts_with("mbot_"));
        assert_eq!(
            token_prefix(&generated.token),
            Some(generated.prefix.as_str())
        );
        assert!(verify_hash(&generated.hash, &hash_token(&generated.token)));
    }
}

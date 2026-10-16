//! Webhook tokens: `mdbw_<prefix>_<secret>`, kept only as a SHA-256.

use rand::RngCore;
use sha2::{Digest, Sha256};

const SECRET_BYTES: usize = 32;
const PREFIX_CHARS: usize = 12;

/// A fresh token. It is URL-path safe: ASCII letters, digits and `_`.
pub fn generate() -> String {
    let mut secret = [0_u8; SECRET_BYTES];
    rand::rng().fill_bytes(&mut secret);
    let secret = hex::encode(secret);
    format!("mdbw_{}_{secret}", &secret[..PREFIX_CHARS])
}

/// The SHA-256 a token is stored and looked up by.
pub fn hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// The part of a token a list shows: `mdbw_<prefix>`.
pub fn prefix(token: &str) -> String {
    token.chars().take("mdbw_".len() + PREFIX_CHARS).collect()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn a_token_is_its_prefix_then_its_secret() {
        let token = generate();
        let parts: Vec<&str> = token.split('_').collect();

        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "mdbw");
        assert_eq!(parts[1].len(), PREFIX_CHARS);
        assert_eq!(parts[2].len(), SECRET_BYTES * 2);
        assert!(parts[2].starts_with(parts[1]));
        assert_eq!(prefix(&token), format!("mdbw_{}", parts[1]));
    }

    #[test]
    fn two_tokens_differ() {
        assert_ne!(generate(), generate());
    }
}

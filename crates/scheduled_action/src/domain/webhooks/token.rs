//! Webhook URL tokens: `mrw_<prefix>_<secret>`, kept only as a SHA-256.

use rand::RngCore;
use sha2::{Digest, Sha256};

const SCHEME: &str = "mrw_";
const SECRET_BYTES: usize = 32;
const PREFIX_CHARS: usize = 12;

/// A fresh token. It is URL-path safe: ASCII letters, digits and `_`.
pub fn generate() -> String {
    let mut secret = [0_u8; SECRET_BYTES];
    rand::rng().fill_bytes(&mut secret);
    let secret = hex::encode(secret);
    format!("{SCHEME}{}_{secret}", &secret[..PREFIX_CHARS])
}

/// The SHA-256 a token is stored and looked up by.
pub fn hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// The part of a token a list shows: `mrw_<prefix>`.
pub fn prefix(token: &str) -> String {
    token.chars().take(SCHEME.len() + PREFIX_CHARS).collect()
}

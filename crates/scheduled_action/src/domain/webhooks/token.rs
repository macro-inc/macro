//! Webhook tokens: `mrw_<prefix>_<secret>`, kept only as a SHA-256.

use rand::RngCore;
use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

const SCHEME: &str = "mrw_";
const SECRET_BYTES: usize = 32;
const PREFIX_CHARS: usize = 12;

/// The secret a routine's webhook URL carries. It is URL-path safe: ASCII
/// lowercase hex, `_` and the `mrw` scheme.
#[derive(Clone, PartialEq, Eq)]
pub struct WebhookToken(String);

impl std::fmt::Debug for WebhookToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "WebhookToken({}…)", self.prefix())
    }
}

impl WebhookToken {
    /// A fresh token.
    pub fn generate() -> Self {
        let mut secret = [0_u8; SECRET_BYTES];
        rand::rng().fill_bytes(&mut secret);
        let secret = hex::encode(secret);
        Self(format!("{SCHEME}{}_{secret}", &secret[..PREFIX_CHARS]))
    }

    /// A token of the shape [`Self::generate`] makes; None for anything else,
    /// which no routine can have.
    pub fn parse(token: &str) -> Option<Self> {
        let (_, prefix, secret) =
            lazy_regex::regex_captures!(r"^mrw_([0-9a-f]{12})_([0-9a-f]{64})$", token)?;
        secret.starts_with(prefix).then(|| Self(token.to_owned()))
    }

    /// The SHA-256 the token is stored and looked up by.
    pub fn hash(&self) -> [u8; 32] {
        Sha256::digest(self.0.as_bytes()).into()
    }

    /// The part of the token a routine shows: `mrw_<prefix>`.
    pub fn prefix(&self) -> &str {
        &self.0[..SCHEME.len() + PREFIX_CHARS]
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

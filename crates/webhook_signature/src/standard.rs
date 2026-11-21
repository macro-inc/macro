//! [Standard Webhooks](https://www.standardwebhooks.com/) signatures, the
//! scheme the MCP Events extension requires for webhook deliveries.
//!
//! It differs from Macro's own `x-macro-signature` scheme in the crate root:
//! the secret is a `whsec_`-prefixed base64 key whose decoded bytes key the
//! HMAC, the signed content is `"{webhook-id}.{webhook-timestamp}.{body}"`,
//! and the signature is `v1,<base64>`. A header may carry several
//! space-delimited signatures during secret rotation.

#[cfg(test)]
#[path = "standard_test.rs"]
mod test;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::fmt;
use zeroize::Zeroizing;

type HmacSha256 = Hmac<Sha256>;

/// Header carrying the message id; unique per message, reused on retries.
pub const ID_HEADER: &str = "webhook-id";

/// Header carrying the Unix timestamp (seconds) the signature covers.
pub const TIMESTAMP_HEADER: &str = "webhook-timestamp";

/// Header carrying one or more space-delimited `v1,<base64>` signatures.
pub const SIGNATURE_HEADER: &str = "webhook-signature";

/// Prefix of a Standard Webhooks symmetric secret.
pub const SECRET_PREFIX: &str = "whsec_";

/// Fewest decoded key bytes the MCP Events extension accepts.
pub const MIN_SECRET_BYTES: usize = 24;

/// Most decoded key bytes the MCP Events extension accepts.
pub const MAX_SECRET_BYTES: usize = 64;

const SIGNATURE_VERSION_PREFIX: &str = "v1,";

/// Why a `whsec_` secret was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SecretError {
    /// The value does not start with `whsec_`.
    #[error("secret must start with whsec_")]
    MissingPrefix,
    /// The value after the prefix is not standard base64.
    #[error("secret is not valid base64")]
    InvalidBase64,
    /// The decoded key is shorter than 24 or longer than 64 bytes.
    #[error("secret must decode to 24 to 64 bytes")]
    InvalidLength,
}

/// A validated Standard Webhooks signing key.
///
/// Holds the decoded key bytes, zeroizes them on drop, and redacts its
/// `Debug` so the key cannot reach a log through a derived impl.
#[derive(Clone)]
pub struct SigningSecret(Zeroizing<Vec<u8>>);

impl SigningSecret {
    /// Parse a `whsec_<base64>` secret whose key is 24 to 64 bytes.
    pub fn parse(value: &str) -> Result<Self, SecretError> {
        let encoded = value
            .strip_prefix(SECRET_PREFIX)
            .ok_or(SecretError::MissingPrefix)?;
        let key = Zeroizing::new(
            BASE64
                .decode(encoded)
                .map_err(|_| SecretError::InvalidBase64)?,
        );
        if !(MIN_SECRET_BYTES..=MAX_SECRET_BYTES).contains(&key.len()) {
            return Err(SecretError::InvalidLength);
        }
        Ok(Self(key))
    }

    /// The `whsec_` form, for storing or handing to a receiver.
    #[must_use]
    pub fn expose(&self) -> Zeroizing<String> {
        let encoded = Zeroizing::new(BASE64.encode(&*self.0));
        // Sized up front, so no growth leaves a copy behind.
        let mut exposed =
            Zeroizing::new(String::with_capacity(SECRET_PREFIX.len() + encoded.len()));
        exposed.push_str(SECRET_PREFIX);
        exposed.push_str(&encoded);
        exposed
    }

    fn mac(&self, message_id: &str, timestamp: i64, body: &[u8]) -> Option<HmacSha256> {
        let mut mac = HmacSha256::new_from_slice(&self.0).ok()?;
        mac.update(message_id.as_bytes());
        mac.update(b".");
        mac.update(timestamp.to_string().as_bytes());
        mac.update(b".");
        mac.update(body);
        Some(mac)
    }

    /// Sign a message: one `v1,<base64>` entry for the `webhook-signature`
    /// header.
    ///
    /// `None` only when the key cannot key an HMAC, which HMAC-SHA256 never
    /// refuses; kept fallible so a future algorithm cannot silently panic.
    #[must_use]
    pub fn sign(&self, message_id: &str, timestamp: i64, body: &[u8]) -> Option<String> {
        let digest = self
            .mac(message_id, timestamp, body)?
            .finalize()
            .into_bytes();
        Some(format!(
            "{SIGNATURE_VERSION_PREFIX}{}",
            BASE64.encode(digest)
        ))
    }

    /// Whether any `v1,` entry of a `webhook-signature` header verifies, in
    /// constant time per entry. Entries of other versions are ignored.
    ///
    /// This checks the signature only; the receiver also rejects stale
    /// timestamps and deduplicates on `webhook-id`.
    #[must_use]
    pub fn verify(&self, message_id: &str, timestamp: i64, body: &[u8], header: &str) -> bool {
        header
            .split(' ')
            .filter_map(|entry| entry.strip_prefix(SIGNATURE_VERSION_PREFIX))
            .filter_map(|encoded| BASE64.decode(encoded).ok())
            .any(|expected| {
                self.mac(message_id, timestamp, body)
                    .is_some_and(|mac| mac.verify_slice(&expected).is_ok())
            })
    }
}

impl fmt::Debug for SigningSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SigningSecret([REDACTED])")
    }
}

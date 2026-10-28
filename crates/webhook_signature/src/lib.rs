//! Macro webhook delivery signatures: one crate owning both halves, so the
//! signer (webhook delivery) and verifiers (webhook receivers) cannot drift.
//!
//! Deliveries are signed as `v1=<hex>` where the digest is HMAC-SHA256 over
//! `"{timestamp}.{raw_body}"` keyed by the webhook's signing secret. The
//! TypeScript counterpart is `packages/sdk/src/events/verify.ts`.

#![deny(missing_docs)]

use hmac::{Hmac, Mac};
use sha2::Sha256;

#[cfg(test)]
mod test;

type HmacSha256 = Hmac<Sha256>;

/// Header carrying the signature on a delivery.
pub const SIGNATURE_HEADER: &str = "x-macro-signature";

/// Header carrying the timestamp the signature covers.
pub const TIMESTAMP_HEADER: &str = "x-macro-timestamp";

/// Sign a delivery: the `x-macro-signature` header value.
///
/// `None` only when the secret cannot key an HMAC, which for HMAC-SHA256
/// cannot happen for any length - kept fallible so a future algorithm
/// change cannot silently panic.
#[must_use]
pub fn sign(secret: &str, timestamp: &str, raw_body: &[u8]) -> Option<String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(raw_body);
    Some(format!("v1={}", hex::encode(mac.finalize().into_bytes())))
}

/// Verify a delivery's `x-macro-signature` value in constant time.
///
/// An empty secret can never verify: HMAC accepts a zero-length key, so a
/// caller that has not yet learned its real secret would otherwise accept
/// signatures anyone could forge. Fail closed instead.
#[must_use]
pub fn verify(secret: &str, timestamp: &str, raw_body: &[u8], signature: &str) -> bool {
    if secret.is_empty() {
        return false;
    }
    let Some(hex_digest) = signature.strip_prefix("v1=") else {
        return false;
    };
    let Ok(expected) = hex::decode(hex_digest) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(raw_body);
    mac.verify_slice(&expected).is_ok()
}

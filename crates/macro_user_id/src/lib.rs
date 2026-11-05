#![deny(missing_docs)]
//! This module provides a parsing utility for validating macro user ids.
//! This follows the newtype pattern and parse don't validate, where possible

pub(crate) mod byte_range;
pub mod email;
pub mod error;
pub mod lowercased;
pub mod user_id;

pub use cowlike;

/// SHA-256 identity for telemetry, where the email-bearing user ID must not appear.
/// The same lowercase hex format is used by agent git repository directories and brains.
pub fn telemetry_id(user_id: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(user_id.as_bytes()))
}

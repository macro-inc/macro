//! Rate limiting models for the notification service.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

/// Newtype for rate limit keys.
///
/// Callers control what gets rate limited by constructing a key from relevant
/// data (e.g., event type + sender email). The internal value is a hash.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RateLimitKey(Vec<u8>);

impl RateLimitKey {
    /// Create a new rate limit key from raw bytes.
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    /// Create a rate limit key by hashing the input string.
    pub fn from_str_hashed(input: &str) -> Self {
        use std::hash::{DefaultHasher, Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        input.hash(&mut hasher);
        Self(hasher.finish().to_le_bytes().to_vec())
    }

    /// Get the internal bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Convert to a hex string for use as a cache key.
    pub fn to_hex_string(&self) -> String {
        hex::encode(&self.0)
    }
}

/// Result of a rate limit check.
#[derive(Debug)]
pub enum RateLimitResult {
    /// The action is allowed. Contains the current count after increment.
    Allowed {
        /// The current count after increment.
        current_count: u64,
    },
    /// The rate limit has been exceeded.
    Exceeded(RateLimitExceeded),
}

/// Error returned when a rate limit is exceeded.
#[derive(Debug, Error)]
#[error(
    "Rate limit key: {key} was exceeded. Current count is {current_count} but max count is {max_count}"
)]
pub struct RateLimitExceeded {
    /// The key that is exceeded.
    pub key: String,
    /// The current count.
    pub current_count: u64,
    /// The maximum allowed count.
    pub max_count: u64,
}

/// Configuration for rate limiting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    /// Maximum number of actions allowed in the window.
    pub max_count: u64,
    /// Time window for rate limiting.
    pub window: Duration,
}

impl RateLimitConfig {
    /// Create a new rate limit config.
    pub fn new(max_count: u64, window: Duration) -> Self {
        Self { max_count, window }
    }

    /// Rate limit for channel invites: 10 per hour.
    pub fn channel_invite() -> Self {
        Self::new(10, Duration::from_secs(3600))
    }

    /// Rate limit for team invites: 5 per hour.
    pub fn team_invite() -> Self {
        Self::new(5, Duration::from_secs(3600))
    }
}

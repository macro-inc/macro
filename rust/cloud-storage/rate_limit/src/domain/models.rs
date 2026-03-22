//! Rate limiting models.

use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::time::Duration;
use thiserror::Error;
use twox_hash::XxHash64;

/// Newtype for rate limit keys.
///
/// Callers control what gets rate limited by constructing a key from relevant
/// data (e.g., event type + sender email). The internal value is a hash.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RateLimitKey(Vec<u8>);

/// The builder struct for a [`RateLimitKey`].
/// Callers can either append values or finish the building.
pub struct RateLimitKeyBuilder(XxHash64);

impl RateLimitKeyBuilder {
    /// Finish the key building, returning a [`RateLimitKey`].
    pub fn finish(self) -> RateLimitKey {
        RateLimitKey(self.0.finish().to_le_bytes().to_vec())
    }

    /// Append a value to the builder.
    pub fn append<T: Hash>(self, input: &T) -> Self {
        let RateLimitKeyBuilder(mut hasher) = self;
        input.hash(&mut hasher);
        RateLimitKeyBuilder(hasher)
    }
}

impl RateLimitKey {
    /// Create a rate limit key by hashing the input string.
    pub fn from_str_hashed<T: Hash>(input: &T) -> Self {
        Self::builder(input).finish()
    }

    /// Create a builder from an initial value.
    pub fn builder<T: Hash>(input: &T) -> RateLimitKeyBuilder {
        let mut hasher = XxHash64::with_seed(0);
        input.hash(&mut hasher);
        RateLimitKeyBuilder(hasher)
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

/// The return value from the rate limit service
#[derive(Debug)]
pub struct RateLimitTicket {
    pub(crate) result: RateLimitResult,
    pub(crate) key: RateLimitKey,
    pub(crate) config: RateLimitConfig,
}

impl std::ops::Deref for RateLimitTicket {
    type Target = RateLimitResult;

    fn deref(&self) -> &Self::Target {
        &self.result
    }
}

/// Error returned when a rate limit is exceeded.
#[derive(Debug, Error, Clone)]
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
    /// How long until the rate limit window expires.
    pub retry_after: Duration,
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

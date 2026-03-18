//! Port definitions (interfaces) for rate limiting.

use std::future::Future;

use rootcause::Report;

use crate::domain::models::{RateLimitConfig, RateLimitKey, RateLimitResult};

/// Port for rate limiting operations.
pub trait RateLimitPort: Send + Sync + 'static {
    /// Check if the action is allowed without incrementing the counter.
    ///
    /// The `RateLimitKey` is a hashed value - callers control what gets rate
    /// limited by constructing the key from relevant data.
    fn check(
        &self,
        key: &RateLimitKey,
        config: &RateLimitConfig,
    ) -> impl Future<Output = Result<RateLimitResult, Report>> + Send;

    /// Increment the rate limit counter for a key.
    ///
    /// Should only be called after a successful action.
    fn increment(
        &self,
        key: &RateLimitKey,
        config: &RateLimitConfig,
    ) -> impl Future<Output = Result<u64, Report>> + Send;
}

//! Port definitions (interfaces) for rate limiting.

use std::future::Future;

use rootcause::Report;

use crate::domain::models::{RateLimitConfig, RateLimitKey, RateLimitOk, RateLimitResult};

/// Port for rate limiting operations.
pub trait RateLimitPort: Send + Sync + 'static {
    /// Atomically check and increment the rate limit counter.
    ///
    /// If the current count is below the limit, the counter is incremented and
    /// `Ok(RateLimitOk)` is returned. If the limit is already reached,
    /// `Err(RateLimitExceeded)` is returned without incrementing.
    ///
    /// The `RateLimitKey` is a hashed value - callers control what gets rate
    /// limited by constructing the key from relevant data.
    fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> impl Future<Output = Result<RateLimitResult, Report>> + Send;

    /// Decrement the rate limit counter for a key.
    ///
    /// Used to roll back a previously counted request when the action fails.
    fn decrement(&self, key: &RateLimitKey) -> impl Future<Output = Result<(), Report>> + Send;
}

/// The external facing service interface.
///
/// `check_rate_limit` atomically checks and increments the counter.
/// If the downstream action fails, call `rollback_ticket` to decrement.
pub trait RateLimitService: Send + Sync + 'static {
    /// Atomically check and increment the rate limit, returning a ticket on success.
    fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> impl Future<Output = Result<RateLimitResult, Report>> + Send;

    /// Roll back a previously counted request when the action fails.
    fn rollback_ticket(
        &self,
        ticket: RateLimitOk,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

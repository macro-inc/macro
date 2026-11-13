//! Port definitions (interfaces) for rate limiting.

use std::future::Future;

use rootcause::Report;

use crate::domain::models::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitOk, RateLimitResult,
};

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

/// Port for limits on actions that cost more than one each, such as a send
/// that counts once per recipient.
pub trait RateBudgetPort: Send + Sync + 'static {
    /// Atomically add `cost` to the window's count when all of it fits under
    /// the limit, returning the count afterwards.
    ///
    /// When it does not fit, nothing is added and `Err(RateLimitExceeded)`
    /// says how long until the window ends. A spend is not rolled back.
    fn spend(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
        cost: u64,
    ) -> impl Future<Output = Result<Result<u64, RateLimitExceeded>, Report>> + Send;
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

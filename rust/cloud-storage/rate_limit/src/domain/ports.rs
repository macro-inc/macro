//! Port definitions (interfaces) for rate limiting.

use std::future::Future;

use rootcause::Report;

use crate::domain::models::{RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitTicket};

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

/// the external facing service interface, this signature enforces that users are incrementing at most 1 time per ticket read
pub trait RateLimitService: Send + Sync + 'static {
    /// check the rate limit, returning a ticket which can be used to increment the counter
    fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> impl Future<Output = Result<RateLimitTicket, Report>> + Send;

    /// increment the counter for a given ticket
    fn increment_ticket(
        &self,
        ticket: RateLimitTicket,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

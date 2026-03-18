use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitPort, RateLimitResult};
use rootcause::Report;

/// Rate limiter that always allows (no-op for sandbox).
pub struct NoOpRateLimiter;

impl RateLimitPort for NoOpRateLimiter {
    async fn check(
        &self,
        _key: &RateLimitKey,
        _config: &RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        Ok(RateLimitResult::Allowed { current_count: 0 })
    }

    async fn increment(
        &self,
        _key: &RateLimitKey,
        _config: &RateLimitConfig,
    ) -> Result<u64, Report> {
        Ok(0)
    }
}

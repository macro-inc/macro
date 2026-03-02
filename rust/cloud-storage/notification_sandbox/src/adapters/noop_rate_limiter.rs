use notification::domain::models::{RateLimitConfig, RateLimitKey, RateLimitResult};
use notification::domain::ports::RateLimitPort;
use rootcause::Report;

/// Rate limiter that always allows (no-op for sandbox).
pub struct NoOpRateLimiter;

impl RateLimitPort for NoOpRateLimiter {
    async fn check_and_increment(
        &self,
        _key: &RateLimitKey,
        _config: &RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        Ok(RateLimitResult::Allowed { current_count: 0 })
    }
}

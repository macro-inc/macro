use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitPort, RateLimitResult, domain::models::RateLimitOk,
};
use rootcause::Report;

/// Rate limit port that always allows (no-op for sandbox).
pub struct NoOpRateLimitPort;

impl RateLimitPort for NoOpRateLimitPort {
    async fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        Ok(RateLimitResult::Ok(RateLimitOk::new_testing_value(
            0, key, config,
        )))
    }

    async fn increment(
        &self,
        _key: &RateLimitKey,
        _config: &RateLimitConfig,
    ) -> Result<u64, Report> {
        Ok(0)
    }
}

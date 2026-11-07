use rootcause::Report;

use crate::{
    RateLimitConfig, RateLimitKey, RateLimitPort, RateLimitResult,
    domain::{models::RateLimitOk, ports::RateLimitService},
};

/// a concrete struct which implements [RateLimitService]
#[derive(Clone)]
pub struct RateLimitServiceImpl<R> {
    /// the inner impl of [RateLimitPort]
    pub repo: R,
}

impl<R> RateLimitService for RateLimitServiceImpl<R>
where
    R: RateLimitPort,
{
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        let result = self.repo.check(key, config).await?;
        Ok(result)
    }

    #[tracing::instrument(err, skip(self))]
    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), Report> {
        self.repo.decrement(&ticket.key).await
    }
}

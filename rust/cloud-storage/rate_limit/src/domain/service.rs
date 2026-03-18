use rootcause::Report;

use crate::{
    RateLimitConfig, RateLimitKey, RateLimitPort,
    domain::{models::RateLimitTicket, ports::RateLimitService},
};

/// a concrete struct which implements [RateLimitService]
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
    ) -> Result<RateLimitTicket, Report> {
        let result = self.repo.check(&key, &config).await?;
        Ok(RateLimitTicket {
            result,
            key,
            config,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn increment_ticket(&self, ticket: RateLimitTicket) -> Result<(), Report> {
        self.repo.increment(&ticket.key, &ticket.config).await?;
        Ok(())
    }
}

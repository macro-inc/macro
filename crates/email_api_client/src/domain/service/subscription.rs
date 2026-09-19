use models_email::service::link::Link;
use uuid::Uuid;

use super::super::models::{EmailApiError, ProviderSubscription, TokenFreshness};
use super::super::ports::{MailboxSubscriptionClient, ProviderRateLimiter, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSubscriptionClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Registers or renews the linked mailbox's notification subscription.
    #[tracing::instrument(skip(self), err)]
    pub async fn register_subscription(
        &self,
        link_id: Uuid,
    ) -> Result<ProviderSubscription, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::Subscribe).await?;
        self.repository.subscribe(&access_token).await
    }

    /// Registers a subscription using a freshly fetched token.
    ///
    /// This is intended for mailbox initialization, where a cached access token
    /// could outlive a revoked provider grant.
    #[tracing::instrument(skip(self, link), fields(link_id = %link.id), err)]
    pub async fn register_subscription_without_cache(
        &self,
        link: &Link,
    ) -> Result<ProviderSubscription, EmailApiError> {
        self.rate_limiter
            .check_rate_limit(link.id, ApiOperationKind::Subscribe)
            .await
            .map_err(EmailApiError::from)?;
        let access_token = self
            .token_source
            .get_access_token_for_link(link, TokenFreshness::Fresh)
            .await
            .map_err(super::map_token_error)?;

        self.repository.subscribe(&access_token).await
    }

    /// Stops the linked mailbox's notification subscription.
    #[tracing::instrument(skip(self), err)]
    pub async fn stop_subscription(&self, link_id: Uuid) -> Result<(), EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::Unsubscribe).await?;
        self.repository.unsubscribe(&access_token).await
    }

    /// Stops the mailbox's subscription without token-health side effects.
    ///
    /// This is intended for link teardown: a grant that died since the last
    /// probe must not set `needs_reauth` or fan out a reauthorization
    /// notification for an inbox that is being intentionally removed.
    #[tracing::instrument(skip(self, link), fields(link_id = %link.id), err)]
    pub async fn stop_subscription_for_link(&self, link: &Link) -> Result<(), EmailApiError> {
        self.rate_limiter
            .check_rate_limit(link.id, ApiOperationKind::Unsubscribe)
            .await
            .map_err(EmailApiError::from)?;
        let access_token = self
            .token_source
            .get_access_token_health_neutral(link, TokenFreshness::Cached)
            .await
            .map_err(super::map_token_error)?;

        self.repository.unsubscribe(&access_token).await
    }
}

#[cfg(test)]
mod test;

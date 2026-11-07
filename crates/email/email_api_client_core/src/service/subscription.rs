use models_email::service::link::Link;
use uuid::Uuid;

use super::super::models::{EmailApiError, ProviderSubscription, TokenFreshness};
use super::super::ports::{MailboxSubscriptionClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl, log_operation_error};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSubscriptionClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Registers or renews the linked mailbox's notification subscription.
    #[tracing::instrument(skip(self), fields(gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn register_subscription(
        &self,
        link_id: Uuid,
    ) -> Result<ProviderSubscription, EmailApiError> {
        self.call_with_token(link_id, ApiOperationKind::Subscribe, |token| async move {
            self.repository
                .subscribe(&token)
                .await
                .inspect_err(log_operation_error)
        })
        .await
    }

    /// Registers a subscription using a freshly fetched token.
    ///
    /// This is intended for mailbox initialization, where a cached access token
    /// could outlive a revoked provider grant.
    #[tracing::instrument(skip(self, link), fields(link_id = %link.id, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn register_subscription_without_cache(
        &self,
        link: &Link,
    ) -> Result<ProviderSubscription, EmailApiError> {
        let token = async {
            self.token_source
                .get_access_token_for_link(link, TokenFreshness::Fresh)
                .await
                .map_err(super::map_token_error)
        };
        self.attempt(
            link.id,
            ApiOperationKind::Subscribe,
            token,
            |token| async move {
                self.repository
                    .subscribe(&token)
                    .await
                    .inspect_err(log_operation_error)
            },
        )
        .await?
    }

    /// Stops the linked mailbox's notification subscription.
    #[tracing::instrument(skip(self), fields(gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn stop_subscription(&self, link_id: Uuid) -> Result<(), EmailApiError> {
        self.call_with_token(link_id, ApiOperationKind::Unsubscribe, |token| async move {
            self.repository
                .unsubscribe(&token)
                .await
                .inspect_err(log_operation_error)
        })
        .await
    }

    /// Stops the mailbox's subscription without token-health side effects.
    ///
    /// This is intended for link teardown: a grant that died since the last
    /// probe must not set `needs_reauth` or fan out a reauthorization
    /// notification for an inbox that is being intentionally removed.
    #[tracing::instrument(skip(self, link), fields(link_id = %link.id, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn stop_subscription_for_link(&self, link: &Link) -> Result<(), EmailApiError> {
        let token = async {
            self.token_source
                .get_access_token_health_neutral(link, TokenFreshness::Cached)
                .await
                .map_err(super::map_token_error)
        };
        self.attempt(
            link.id,
            ApiOperationKind::Unsubscribe,
            token,
            |token| async move {
                self.repository
                    .unsubscribe(&token)
                    .await
                    .inspect_err(log_operation_error)
            },
        )
        .await?
    }
}

#[cfg(test)]
mod test;

use super::*;

impl<R: MailboxWatchClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Execute a subscription capability under the current credential and rate-limit binding.
    pub async fn watches(
        &self,
        mailbox: MailboxAccess,
    ) -> Result<Vec<MailboxWatchDetails>, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(mailbox, ApiOperationKind::Subscribe, TokenFreshness::Cached)
            .await?;
        match repository.watches(&token).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(mailbox, ApiOperationKind::Subscribe, TokenFreshness::Fresh)
                    .await?;
                repository.watches(&fresh).await
            }
            result => result,
        }
    }
}

impl<R: MailboxWatchClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Execute a subscription capability under the current credential and rate-limit binding.
    pub async fn create_watch(
        &self,
        mailbox: MailboxAccess,
        notification_url: &str,
        lifecycle_url: &str,
        client_state: &str,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(mailbox, ApiOperationKind::Subscribe, TokenFreshness::Cached)
            .await?;
        match repository
            .create_watch(
                &token,
                notification_url,
                lifecycle_url,
                client_state,
                expires_at,
            )
            .await
        {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(mailbox, ApiOperationKind::Subscribe, TokenFreshness::Fresh)
                    .await?;
                repository
                    .create_watch(
                        &fresh,
                        notification_url,
                        lifecycle_url,
                        client_state,
                        expires_at,
                    )
                    .await
            }
            result => result,
        }
    }
}

impl<R: MailboxWatchClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Execute a subscription capability under the current credential and rate-limit binding.
    pub async fn renew_watch(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(mailbox, ApiOperationKind::Subscribe, TokenFreshness::Cached)
            .await?;
        match repository.renew_watch(&token, id, expires_at).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(mailbox, ApiOperationKind::Subscribe, TokenFreshness::Fresh)
                    .await?;
                repository.renew_watch(&fresh, id, expires_at).await
            }
            result => result,
        }
    }
}

impl<R: MailboxWatchClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxApiService<R, T, L>
{
    /// Execute a subscription capability under the current credential and rate-limit binding.
    pub async fn remove_watch(
        &self,
        mailbox: MailboxAccess,
        id: &ProviderId,
    ) -> Result<(), EmailApiError> {
        let repository = self.repository.for_mailbox(mailbox);
        let token = self
            .token(
                mailbox,
                ApiOperationKind::Unsubscribe,
                TokenFreshness::Cached,
            )
            .await?;
        match repository.remove_watch(&token, id).await {
            Err(EmailApiError::AuthRequired) => {
                let fresh = self
                    .token(
                        mailbox,
                        ApiOperationKind::Unsubscribe,
                        TokenFreshness::Fresh,
                    )
                    .await?;
                repository.remove_watch(&fresh, id).await
            }
            result => result,
        }
    }
}

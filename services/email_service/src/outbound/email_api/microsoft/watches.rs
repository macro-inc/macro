use super::*;
use chrono::{DateTime, Utc};
use email::domain::mailbox::watches::MailboxWatchGateway;

impl<R: MailboxWatchClient + ScopedMailboxRepository, T: MailboxTokenSource, L: ProviderRateLimiter>
    MailboxWatchGateway for ProviderMailboxGateway<R, T, L>
{
    async fn watches(&self, key: MailboxKey) -> Result<Vec<MailboxWatchDetails>, EmailApiError> {
        self.0.watches(access(key)).await
    }
    async fn create_watch(
        &self,
        key: MailboxKey,
        url: &str,
        state: &str,
        expires: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        self.0
            .create_watch(access(key), url, url, state, expires)
            .await
    }
    async fn renew_watch(
        &self,
        key: MailboxKey,
        id: &ProviderId,
        expires: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        self.0.renew_watch(access(key), id, expires).await
    }
    async fn remove_watch(&self, key: MailboxKey, id: &ProviderId) -> Result<(), EmailApiError> {
        self.0.remove_watch(access(key), id).await
    }
}

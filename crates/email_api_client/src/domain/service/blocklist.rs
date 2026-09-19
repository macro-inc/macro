use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxBlocklistClient, ProviderRateLimiter, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxBlocklistClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Ensures messages from an email address are sent to trash.
    #[tracing::instrument(skip(self, email_address), err)]
    pub async fn block_sender(
        &self,
        link_id: Uuid,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::BlockSender).await?;

        self.repository
            .block_sender(&access_token, email_address)
            .await
    }

    /// Removes the blocked-sender rule for an email address, when present.
    #[tracing::instrument(skip(self, email_address), err)]
    pub async fn unblock_sender(
        &self,
        link_id: Uuid,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        let access_token = self
            .prepare(link_id, ApiOperationKind::UnblockSender)
            .await?;

        self.repository
            .unblock_sender(&access_token, email_address)
            .await
    }

    /// Lists email addresses covered by blocked-sender rules.
    #[tracing::instrument(skip(self), err)]
    pub async fn list_blocked_senders(&self, link_id: Uuid) -> Result<Vec<String>, EmailApiError> {
        let access_token = self
            .prepare(link_id, ApiOperationKind::ListBlockedSenders)
            .await?;

        self.repository.list_blocked_senders(&access_token).await
    }
}

#[cfg(test)]
mod test;

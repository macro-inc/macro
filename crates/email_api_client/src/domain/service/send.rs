use uuid::Uuid;

use super::super::models::{EmailApiError, SendRequest, SentIds};
use super::super::ports::{MailboxSendClient, ProviderRateLimiter, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSendClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Sends a message through the linked mailbox.
    #[tracing::instrument(skip(self, request), err)]
    pub async fn send_message(
        &self,
        link_id: Uuid,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::SendMessage).await?;

        self.repository
            .send_message(&access_token, request, provider_thread_id)
            .await
    }
}

#[cfg(test)]
mod test;

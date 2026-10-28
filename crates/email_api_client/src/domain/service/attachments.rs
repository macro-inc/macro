use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxAttachmentClient, ProviderRateLimiter, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxAttachmentClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Downloads an attachment from a provider message.
    #[tracing::instrument(skip(self), fields(retry_count = 0))]
    pub async fn get_attachment(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
        provider_attachment_id: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        self.read_with_token(
            link_id,
            ApiOperationKind::GetAttachment,
            |token| async move {
                self.repository
                    .get_attachment(&token, provider_message_id, provider_attachment_id)
                    .await
            },
        )
        .await
    }
}

#[cfg(test)]
mod test;

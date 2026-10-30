use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxRawMessageClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxRawMessageClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Downloads a provider message's original RFC 822 bytes.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_raw_message(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetMessage, |token| async move {
            self.repository
                .get_raw_message(&token, provider_message_id)
                .await
        })
        .await
    }
}

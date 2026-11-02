use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxBlocklistClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl, log_operation_error};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxBlocklistClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Ensures messages from an email address are sent to trash.
    #[tracing::instrument(skip(self, email_address), fields(gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn block_sender(
        &self,
        link_id: Uuid,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        self.call_with_token(link_id, ApiOperationKind::BlockSender, |token| async move {
            self.repository
                .block_sender(&token, email_address)
                .await
                .inspect_err(log_operation_error)
        })
        .await
    }

    /// Removes the blocked-sender rule for an email address, when present.
    #[tracing::instrument(skip(self, email_address), fields(gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn unblock_sender(
        &self,
        link_id: Uuid,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        self.call_with_token(
            link_id,
            ApiOperationKind::UnblockSender,
            |token| async move {
                self.repository
                    .unblock_sender(&token, email_address)
                    .await
                    .inspect_err(log_operation_error)
            },
        )
        .await
    }

    /// Lists email addresses covered by blocked-sender rules.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn list_blocked_senders(&self, link_id: Uuid) -> Result<Vec<String>, EmailApiError> {
        self.read_with_token(
            link_id,
            ApiOperationKind::ListBlockedSenders,
            |token| async move { self.repository.list_blocked_senders(&token).await },
        )
        .await
    }
}

#[cfg(test)]
mod test;

use uuid::Uuid;

use super::super::models::{ChangeBatch, EmailApiError, SyncCursor};
use super::super::ports::{MailboxSyncClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSyncClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Returns the number of threads reported by a linked mailbox.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_thread_count(&self, link_id: Uuid) -> Result<u64, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetProfile, |token| async move {
            self.repository.get_thread_count(&token).await
        })
        .await
    }

    /// Lists mailbox changes following `cursor`.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn list_changes(
        &self,
        link_id: Uuid,
        cursor: &SyncCursor,
    ) -> Result<ChangeBatch, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::ListChanges, |token| async move {
            self.repository.list_changes(&token, cursor).await
        })
        .await
    }
}

#[cfg(test)]
mod test;

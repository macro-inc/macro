use uuid::Uuid;

use super::super::models::{ChangeBatch, EmailApiError, SyncCursor};
use super::super::ports::{MailboxSyncClient, ProviderRateLimiter, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl, log_operation_error};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSyncClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Returns the number of threads reported by a linked mailbox.
    #[tracing::instrument(skip(self))]
    pub async fn get_thread_count(&self, link_id: Uuid) -> Result<u64, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::GetProfile).await?;

        self.repository
            .get_thread_count(&access_token)
            .await
            .inspect_err(log_operation_error)
    }

    /// Lists mailbox changes following `cursor`.
    #[tracing::instrument(skip(self), fields(retry_count = 0))]
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

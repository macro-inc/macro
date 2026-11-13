//! Transaction-scoped facts and effects used by the incremental purge algorithm.

use std::num::NonZeroU32;
use uuid::Uuid;

/// Message identity and its position in the existing thread-ordered scan.
pub struct PurgeMessage {
    /// Selected message identity.
    pub id: Uuid,
    /// Selected thread identity.
    pub thread_id: Uuid,
}

/// Contact identity and its position in the existing address-ordered scan.
pub struct PurgeContact {
    /// Selected contact identity.
    pub id: Uuid,
    /// Selected address, kept verbatim as the next scan cursor.
    pub email_address: String,
}

/// Starts transactions that retain the existing per-link advisory lock.
pub trait LinkPurgeRepository: Send + Sync + 'static {
    /// Dropping an unfinished transaction retains the adapter's rollback behavior.
    type Transaction: LinkPurgeTransaction;
    /// Preserve the idempotent mark and its existing tracing span.
    fn mark_link_deleting(&self, link_id: Uuid) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Begin a transaction and take the same per-link purge lock before returning it.
    fn begin_batch(
        &self,
        link_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Self::Transaction>> + Send;
    /// Bytes of WAL the server has generated so far, read outside any batch transaction.
    fn wal_position(&self) -> impl Future<Output = anyhow::Result<u64>> + Send;
}

/// SQL effects issued by the domain in their original order, within one transaction.
pub trait LinkPurgeTransaction: Send {
    /// Select the next bounded message batch in the existing thread order.
    fn messages(
        &mut self,
        link_id: Uuid,
        thread_cursor: Uuid,
        limit: NonZeroU32,
    ) -> impl Future<Output = anyhow::Result<Vec<PurgeMessage>>> + Send;
    /// Delete labels attached to the selected messages.
    fn delete_message_labels(
        &mut self,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Delete recipients attached to the selected messages.
    fn delete_message_recipients(
        &mut self,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Detach selected SFS rows for the separate storage-cleanup worker.
    fn detach_message_files(
        &mut self,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Delete attachment rows attached to the selected messages.
    fn delete_message_attachments(
        &mut self,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Delete schedules attached to the selected messages.
    fn delete_scheduled_messages(
        &mut self,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Delete the selected messages and return the actual affected-row count.
    fn delete_message_rows(
        &mut self,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
    /// Delete history for the selected threads, scoped to the link.
    fn delete_thread_history(
        &mut self,
        link_id: Uuid,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Delete the selected threads, scoped to the link, returning actual affected rows.
    fn delete_thread_rows(
        &mut self,
        link_id: Uuid,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
    /// Select the next bounded remaining-thread batch without adding an order.
    fn threads(
        &mut self,
        link_id: Uuid,
        limit: NonZeroU32,
    ) -> impl Future<Output = anyhow::Result<Vec<Uuid>>> + Send;
    /// Select contacts in the existing address order from the supplied cursor.
    fn contacts(
        &mut self,
        link_id: Uuid,
        email_cursor: &str,
        limit: NonZeroU32,
    ) -> impl Future<Output = anyhow::Result<Vec<PurgeContact>>> + Send;
    /// Delete selected contacts and return actual affected rows.
    fn delete_contact_rows(
        &mut self,
        ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
    /// Delete only the marked link and return actual affected rows.
    fn delete_marked_link(
        &mut self,
        link_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
    /// Commit exactly this batch; preserve the original error if commit fails.
    fn commit(self) -> impl Future<Output = anyhow::Result<()>> + Send;
}

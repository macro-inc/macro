//! Message deletion sequencing and deferred identity resolution.
use models_email::service::message::SimpleMessage;
use uuid::Uuid;

pub use crate::domain::mailbox::inbox_sync::MessageDeletion;

/// Identity locked before resolving a retained deletion.
pub struct DeletionMessage {
    /// Current containing thread.
    pub thread_id: Uuid,
    /// Current provider identity.
    pub provider_id: Option<String>,
    /// Current draft editing lifetime.
    pub draft_generation: i32,
    /// Whether attachment flags are unaffected by this deletion.
    pub is_draft: bool,
}
/// Identity captured at the original deletion request.
pub struct DeferredDeletion {
    /// Provider identity at the request.
    pub provider_id: Option<String>,
    /// Editing lifetime at the request.
    pub draft_generation: i32,
}
/// Identity needed to publish deletion after commit.
pub struct DeferredMessageDeleted {
    /// Thread containing the deleted message.
    pub thread_id: Uuid,
    /// Provider identity the deferred deletion targeted.
    pub provider_id: String,
}
/// Statements on a caller-owned message deletion transaction.
pub trait DeletionQueries: EmptyThreadQueries + Send {
    /// Delete the row subject to the storage retention trigger.
    fn delete_message(
        &mut self,
        message: Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Whether a deletion request remains retained.
    fn has_deferred(&mut self, message: Uuid) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Serialize deletions within the thread.
    fn lock_thread(&mut self, thread: Uuid) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Refresh surviving-thread metadata.
    fn metadata(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Refresh surviving-thread attachment flags.
    fn attachment_flags(&mut self, thread: Uuid)
    -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Lock and read the current message identity.
    fn message(
        &mut self,
        message: Uuid,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<DeletionMessage>>> + Send;
    /// Read the original deletion identity.
    fn deferred(
        &mut self,
        message: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<DeferredDeletion>>> + Send;
    /// Retire a stale deletion request.
    fn remove_deferred(&mut self, message: Uuid)
    -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Read whether a live attempt still needs the retained message.
    fn active_attempt(
        &mut self,
        message: Uuid,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Read storage-normalized cleanup addresses before the cascade.
    fn recipients(
        &mut self,
        message: Uuid,
    ) -> impl Future<Output = anyhow::Result<Vec<String>>> + Send;
    /// Queue contact cleanup after the thread lock.
    fn cleanup_contacts(
        &mut self,
        link: Uuid,
        emails: &[String],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// A retained-deletion transaction with an explicit commit and implicit early drop.
pub trait DeletionTransaction: Send + Sized {
    /// Borrowed statement capabilities.
    type Queries: DeletionQueries;
    /// Access statements without releasing the transaction's locks.
    fn queries(&mut self) -> &mut Self::Queries;
    /// Commit the resolved or stale deletion.
    fn commit(self) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// Acquisition of an independent retained-deletion transaction.
pub trait DeletionStore: Sync {
    /// Owned transaction.
    type Transaction: DeletionTransaction;
    /// Begin the original transaction.
    fn begin(&self) -> impl Future<Output = anyhow::Result<Self::Transaction>> + Send;
}

/// Delete the snapshot already locked by its caller.
#[tracing::instrument(target = "email_db_client::messages::delete", skip(tx, message), fields(link_id = %message.link_id), err)]
pub async fn delete_message_with_tx(
    tx: &mut impl DeletionQueries,
    message: &SimpleMessage,
) -> anyhow::Result<MessageDeletion> {
    delete_message_in_thread(
        tx,
        message.db_id,
        message.thread_db_id,
        message.link_id,
        message.is_draft,
    )
    .await
}

async fn delete_message_in_thread(
    tx: &mut impl DeletionQueries,
    message_id: Uuid,
    thread_id: Uuid,
    link_id: Uuid,
    is_draft: bool,
) -> anyhow::Result<MessageDeletion> {
    if !tx.delete_message(message_id).await? {
        let deferred = tx.has_deferred(message_id).await?;
        return Ok(if deferred {
            MessageDeletion::Deferred
        } else {
            MessageDeletion::AlreadyDeleted
        });
    }
    tx.lock_thread(thread_id).await?;
    let deleted_thread = delete_thread_if_empty(tx, thread_id).await?;
    if !deleted_thread {
        tx.metadata(thread_id, link_id).await?;
    }
    if !deleted_thread && !is_draft {
        tx.attachment_flags(thread_id).await?;
    }
    Ok(MessageDeletion::Deleted {
        deleted_thread: deleted_thread.then_some(thread_id),
    })
}

/// Resolve the retained deletion only after its identity and live attempt allow it.
#[tracing::instrument(target = "email_db_client::messages::delete", skip(pool), err)]
pub async fn reconcile_deferred_deletion(
    pool: &impl DeletionStore,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<DeferredMessageDeleted>> {
    let mut tx = pool.begin().await?;
    let queries = tx.queries();
    let Some(message) = queries.message(message_id, link_id).await? else {
        return Ok(None);
    };
    let Some(deferred) = queries.deferred(message_id).await? else {
        return Ok(None);
    };
    if message.draft_generation != deferred.draft_generation
        || message.provider_id != deferred.provider_id
    {
        queries.remove_deferred(message_id).await?;
        tx.commit().await?;
        return Ok(None);
    }
    if queries.active_attempt(message_id, link_id).await? {
        return Ok(None);
    }
    let crm_emails = queries.recipients(message_id).await?;
    let result = delete_message_in_thread(
        queries,
        message_id,
        message.thread_id,
        link_id,
        message.is_draft,
    )
    .await?;
    queries.cleanup_contacts(link_id, &crm_emails).await?;
    tx.commit().await?;
    tracing::info!(target: "email_db_client::messages::delete", event = "email_send.deferred_deletion_resolved", %message_id, %link_id);
    Ok(match result {
        MessageDeletion::Deleted { .. } => Some(DeferredMessageDeleted {
            thread_id: message.thread_id,
            provider_id: deferred.provider_id.unwrap_or_default(),
        }),
        MessageDeletion::AlreadyDeleted | MessageDeletion::Deferred => None,
    })
}

/// Statement results used to remove a thread only after its last message is gone.
pub trait EmptyThreadQueries: Send {
    /// Read the existing relational presence predicate.
    fn thread_has_messages(
        &mut self,
        thread_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Delete the selected empty thread and return the affected count.
    fn delete_empty_thread(
        &mut self,
        thread_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
}

/// Interpret empty-thread reads and deletion counts in the caller's transaction.
#[tracing::instrument(target = "email_db_client::threads::delete", skip(tx), err)]
pub async fn delete_thread_if_empty(
    tx: &mut impl EmptyThreadQueries,
    thread_id: Uuid,
) -> anyhow::Result<bool> {
    let messages_exist = tx.thread_has_messages(thread_id).await?;
    if messages_exist {
        return Ok(false);
    }
    let affected = tx.delete_empty_thread(thread_id).await?;
    if affected == 0 {
        tracing::warn!(target: "email_db_client::threads::delete", thread_id = %thread_id, "Thread not found for deletion");
        return Ok(false);
    }
    Ok(true)
}

#[cfg(test)]
mod test;

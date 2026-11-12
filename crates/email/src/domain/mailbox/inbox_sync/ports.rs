//! Capabilities for processing one delivered Gmail inbox update.

use super::super::connection::ConnectionSourceError;
use email_api_client::domain::models::EmailApiError;
use futures::future::BoxFuture;
use models_email::gmail::inbox_sync::InboxSyncPubsubMessage;
use models_email::service::pubsub::ProcessingError;
use models_email::{db, service};
use uuid::Uuid;

/// A provider-sync deletion, including a send that still needs its message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageDeletion {
    /// Another operation already removed the message.
    AlreadyDeleted,
    /// An accepted send retains the message until delivery is reconciled.
    Deferred,
    /// The message and, when empty, its thread were deleted.
    Deleted {
        /// Thread removed together with its last message.
        deleted_thread: Option<Uuid>,
    },
}

/// A transaction whose completion preserves the original commit/rollback errors.
pub trait InboxSyncTransaction: Send + Sized {
    /// The original persistence cause.
    type Err: ConnectionSourceError;

    /// Commit a successful body or roll back its original failure.
    fn complete<T: Send>(
        self,
        result: Result<T, ProcessingError>,
    ) -> impl Future<Output = Result<T, ProcessingError>> + Send;
}

/// Locked message deletion and its atomic cleanup work.
pub trait InboxSyncDeleteTransaction: InboxSyncTransaction {
    /// Lock and read the current message, including its draft lifetime.
    fn message_for_update(
        &mut self,
        link_id: Uuid,
        provider_id: &str,
    ) -> impl Future<Output = Result<Option<service::message::SimpleMessage>, Self::Err>> + Send;

    /// Return recipients in the existing query order.
    fn recipients(
        &mut self,
        message_id: Uuid,
    ) -> impl Future<
        Output = Result<Vec<(db::contact::Contact, db::address::EmailRecipientType)>, Self::Err>,
    > + Send;

    /// Return the message's sender, if still present.
    fn sender(
        &mut self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<db::contact::Contact>, Self::Err>> + Send;

    /// Apply deletion to the locked snapshot.
    fn delete(
        &mut self,
        message: &service::message::SimpleMessage,
    ) -> impl Future<Output = Result<MessageDeletion, Self::Err>> + Send;

    /// Record the domain-selected, normalized CRM cleanup addresses in this transaction.
    /// An empty selection still preserves the cleanup call after deletion.
    fn cleanup_contacts(
        &mut self,
        link_id: Uuid,
        emails: Vec<String>,
    ) -> impl Future<Output = Result<(), ProcessingError>> + Send;
}

/// One atomic addition or removal of a message's provider labels.
pub trait InboxSyncLabelTransaction: InboxSyncTransaction {
    /// Insert the provider labels, without staging an outbound Gmail write.
    fn add_labels(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        labels: &[String],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the provider labels from this message.
    fn remove_labels(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        labels: &[String],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Update the denormalized read state in the same transaction.
    fn set_read(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        is_read: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Recompute metadata after changing the message.
    fn update_thread(
        &mut self,
        link_id: Uuid,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Stored facts and transactions used by inbox-sync reconciliation.
pub trait InboxSyncRepository: Send + Sync + 'static {
    /// The original persistence cause.
    type Err: ConnectionSourceError;
    /// Transaction holding the provider-sync message lock.
    type Delete: InboxSyncDeleteTransaction<Err = Self::Err>;
    /// Transaction for one label-diff half.
    type Labels: InboxSyncLabelTransaction<Err = Self::Err>;

    /// Begin a message-deletion transaction.
    fn begin_delete(&self) -> impl Future<Output = Result<Self::Delete, Self::Err>> + Send;
    /// Begin a label-addition or label-removal transaction.
    fn begin_labels(&self) -> impl Future<Output = Result<Self::Labels, Self::Err>> + Send;
    /// Read the delivered inbox's message by its provider identity.
    fn message(
        &self,
        link_id: Uuid,
        provider_id: &str,
    ) -> impl Future<Output = Result<Option<service::message::SimpleMessage>, Self::Err>> + Send;
    /// Read the message's currently stored labels.
    fn labels(
        &self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<db::label::Label>, Self::Err>> + Send;
    /// Read the provider labels whose local writes are still pending.
    fn pending_labels(
        &self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;
    /// Read the recomputed thread within the same inbox.
    fn thread(
        &self,
        link_id: Uuid,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<service::thread::Thread>, Self::Err>> + Send;
}

/// Gmail reads through the existing token source and request gate.
pub trait InboxSyncGmail: Send + Sync + 'static {
    /// Fetch labels, retaining missing-message and provider-error distinctions.
    fn message_labels<'a>(
        &'a self,
        link_id: Uuid,
        provider_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<Vec<String>>, EmailApiError>>;
}

/// Primary and retry publication of inbox-sync operations.
pub trait InboxSyncQueue: Send + Sync + 'static {
    /// The original queue cause.
    type Err: ConnectionSourceError;
    /// Publish follow-up work to the primary queue.
    fn enqueue(
        &self,
        message: InboxSyncPubsubMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Publish already selected backfill or CRM work.
    fn enqueue_backfill(
        &self,
        message: models_email::service::backfill::BackfillPubsubMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Publish a refused operation to the existing retry queue and delay.
    fn enqueue_retry(
        &self,
        message: InboxSyncPubsubMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The frontend refresh corresponding to a committed provider update.
#[derive(Clone, Copy)]
pub enum InboxSyncRefresh {
    /// A message was removed.
    DeleteMessage(Uuid),
    /// A provider message was inserted or refreshed.
    UpsertMessage(Uuid),
    /// A message's labels changed.
    UpdateLabels(Uuid),
}

/// Best-effort frontend refresh using the host's existing gateway.
pub trait InboxSyncRefresher: Send + Sync + 'static {
    /// Preserve the existing feature gate, request, and error logging.
    fn refresh(&self, owner: &str, event: InboxSyncRefresh) -> impl Future<Output = ()> + Send;
}

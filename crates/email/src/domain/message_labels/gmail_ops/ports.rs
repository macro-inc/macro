//! Capabilities used by the queued half of a message-label write.

use crate::domain::mailbox::connection::ConnectionSourceError;
use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use models_email::service::link::Link;
use std::collections::HashMap;
use uuid::Uuid;

/// Position of one pending write among the writes for a message's labels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LabelWriteTurn {
    /// This write can reach Gmail now.
    Send,
    /// A newer unconfirmed write must finish first.
    Wait,
    /// A newer confirmed write already owns the state.
    Superseded,
}

/// Legacy flag update required after inverting the first label in a payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevertedMessageFlag {
    /// The label has no separate message flag.
    None,
    /// Restore the message's read state.
    Read(bool),
    /// Restore the message's starred state.
    Starred(bool),
}

/// Database instructions for undoing a provider-rejected write.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LabelWriteRevert {
    /// Undo only the state still owned by this pending write.
    Pending(Uuid),
    /// The legacy payload has no label to invert.
    NoLabel,
    /// Invert the legacy payload's first label and its corresponding flag.
    Legacy {
        /// Provider label to restore or remove.
        provider_label_id: String,
        /// Whether the optimistic write had added that label.
        was_adding: bool,
        /// Denormalized message flag to restore in the same transaction.
        flag: RevertedMessageFlag,
    },
}

/// Inbox existence and identity for an already-delivered provider operation.
pub trait GmailOpsLinks: Send + Sync + 'static {
    /// Retains the original cause and its legacy error chain.
    type Err: ConnectionSourceError;
    /// Read exactly the delivered inbox, without applying HTTP access policy.
    fn link(&self, id: Uuid) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;
}

/// Pending-write reads and atomic settlements of staged message-label changes.
///
/// Complements `MessageLabelRepository`'s staging/unqueued-write compensation;
/// these operations settle writes that have already reached the provider queue.
pub trait GmailLabelWrites: Send + Sync + 'static {
    /// Retains the original cause and its legacy error chain.
    type Err: ConnectionSourceError;
    /// Read turns using the exact message and provider-label lists supplied.
    fn turns(
        &self,
        message_ids: &[Uuid],
        provider_label_ids: &[String],
        write_id: Uuid,
    ) -> impl Future<Output = Result<HashMap<Uuid, LabelWriteTurn>, Self::Err>> + Send;
    /// Lock the messages' threads and drop superseded pending rows atomically.
    fn abandon(
        &self,
        link_id: Uuid,
        message_ids: &[Uuid],
        write_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Lock the messages' threads and confirm accepted pending rows atomically.
    fn confirm(
        &self,
        link_id: Uuid,
        message_ids: &[Uuid],
        write_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Apply the domain's reversion instructions and recompute affected threads atomically.
    fn revert(
        &self,
        link_id: Uuid,
        message_ids: Vec<Uuid>,
        change: LabelWriteRevert,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
}

/// The existing Gmail service, including its token lookup and request admission gate.
pub trait GmailMailboxOperations: Send + Sync + 'static {
    /// Preserve the provider service's size-dependent label-write behavior.
    fn modify_message_labels(
        &self,
        link_id: Uuid,
        message_ids: &[String],
        add: &[String],
        remove: &[String],
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    /// Send one label write, retaining the provider's missing-message policy.
    fn modify_one_message_labels(
        &self,
        link_id: Uuid,
        message_id: &str,
        add: &[String],
        remove: &[String],
        skip_missing: bool,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    /// Delete a provider label.
    fn delete_label(
        &self,
        link_id: Uuid,
        label_id: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    /// Create the existing provider block filter.
    fn block_sender(
        &self,
        link_id: Uuid,
        address: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    /// Remove the existing provider block filter.
    fn unblock_sender(
        &self,
        link_id: Uuid,
        address: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}

/// Publication of the same operation to the longer-lived retry queue.
pub trait GmailOpsRetryQueue: Send + Sync + 'static {
    /// Retains the original queue error and its legacy context.
    type Err: ConnectionSourceError;
    /// Enqueue the unchanged message, using the queue's existing delay.
    fn enqueue(
        &self,
        message: GmailOpsPubsubMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

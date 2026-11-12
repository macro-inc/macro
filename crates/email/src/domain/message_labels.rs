//! Message-label batch writes and compensation when a provider write cannot be queued.

use super::events::{EmailEventOrigin, EmailMacroEvent, LabelRef};
use super::ports::EmailMessageEnqueuer;
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Most messages admitted by one message-label batch.
pub const MAX_MESSAGE_LABEL_BATCH: usize = 10;

/// An authenticated caller's requested label change.
pub struct MessageLabelChange {
    /// Caller whose own and delegated inboxes may resolve the first message.
    pub caller_macro_id: String,
    /// Authentication identity used by the existing message lookup scope.
    pub caller_fusionauth_user_id: String,
    /// Message ids in request order, including any duplicates.
    pub message_ids: Vec<Uuid>,
    /// Label to add or remove, scoped to the resolved inbox.
    pub label_id: Uuid,
    /// Whether to add the label.
    pub add: bool,
}

/// Batch results in the same order as the repository's messages and request ids.
#[derive(Debug, PartialEq, Eq)]
pub struct MessageLabelOutcome {
    /// Messages whose requested state remains staged.
    pub successful_ids: Vec<Uuid>,
    /// Messages restored because their provider write could not be queued.
    pub failed_ids: Vec<Uuid>,
    /// Requested ids absent from the caller's message lookup.
    pub missing_ids: Vec<Uuid>,
}

/// A failure at one of the batch's observable steps.
#[derive(Debug, thiserror::Error)]
pub enum MessageLabelError<E> {
    /// The batch is empty or exceeds the limit.
    #[error("invalid message-label batch size")]
    BatchSize,
    /// The inbox lookup failed.
    #[error("unable to resolve inbox for messages: {0}")]
    InboxLookup(E),
    /// No accessible inbox contains the first message.
    #[error("message not found")]
    MessageNotFound,
    /// The label lookup failed.
    #[error("unable to fetch label from db: {0}")]
    LabelLookup(E),
    /// The requested label does not belong to the resolved inbox.
    #[error("label not found")]
    LabelNotFound,
    /// The caller's messages could not be read.
    #[error("unable to fetch messages from db: {0}")]
    MessagesLookup(E),
    /// The optimistic database transaction failed.
    #[error(transparent)]
    Stage(#[from] StageFailure),
    /// Neither queueing nor restoring the write succeeded.
    #[error("unable to queue the label change: {0}")]
    Unqueued(E),
}

/// The transaction step that failed, after its original error has been logged.
#[derive(Debug, thiserror::Error)]
pub enum StageFailure {
    /// No transaction could be opened.
    #[error("unable to begin transaction")]
    Begin,
    /// The transaction body failed and rollback was attempted.
    #[error("unable to update labels in database")]
    Change,
    /// The transaction could not be committed.
    #[error("unable to commit transaction")]
    Commit,
}

/// The resolved inbox for a message-label batch.
#[derive(Clone)]
pub struct MessageLabelInbox {
    /// Database identifier of the inbox.
    pub id: Uuid,
    /// Inbox owner attributed in label-change events.
    pub macro_id: MacroUserIdStr<'static>,
}

/// The label definition needed to stage a batch and publish its events.
#[derive(Clone)]
pub struct MessageLabelDefinition {
    /// Database identifier carried in label-change events, when known.
    pub id: Option<Uuid>,
    /// Provider identifier used by persistence and queue writes.
    pub provider_label_id: String,
    /// Display name carried in label-change events, when known.
    pub name: Option<String>,
}

/// An existing message targeted by a message-label batch.
#[derive(Clone)]
pub struct MessageLabelTarget {
    /// Database identifier of the message.
    pub db_id: Uuid,
    /// Database identifier of the thread whose metadata is recomputed.
    pub thread_db_id: Uuid,
    /// Provider identifier, absent on unsynced messages.
    pub provider_id: Option<String>,
}

/// All inputs to one atomic optimistic label write.
#[derive(Clone)]
pub struct StagedLabelWrite {
    /// Inbox that owns the label.
    pub link_id: Uuid,
    /// Sorted, distinct affected threads.
    pub thread_ids: Vec<Uuid>,
    /// Messages returned by the caller-scoped lookup, in repository order.
    pub messages: Vec<MessageLabelTarget>,
    /// Provider identifier of the requested label.
    pub provider_label_id: String,
    /// Whether to add the label.
    pub add: bool,
    /// Identifier shared by pending writes and the queued provider operation.
    pub write_id: Uuid,
}

/// Caller-scoped reads, atomic staging, and compensation for message labels.
pub trait MessageLabelRepository: Send + Sync + 'static {
    /// Persistence failure, retaining its cause for callers.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Resolve the first message through the caller's own and delegated inboxes.
    fn inbox_for_message(
        &self,
        caller_macro_id: &str,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<MessageLabelInbox>, Self::Err>> + Send;

    /// Read a label belonging to the resolved inbox.
    fn label(
        &self,
        label_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Option<MessageLabelDefinition>, Self::Err>> + Send;

    /// Read messages using the authentication identity's existing scope.
    fn messages(
        &self,
        message_ids: &[Uuid],
        caller_fusionauth_user_id: &str,
    ) -> impl Future<Output = Result<Vec<MessageLabelTarget>, Self::Err>> + Send;

    /// Lock, mark, apply, and commit a label write, returning changed provider messages.
    fn stage(
        &self,
        write: StagedLabelWrite,
    ) -> impl Future<Output = Result<Vec<(Uuid, String)>, StageFailure>> + Send;

    /// Restore an unqueued write under the threads' label-write locks.
    fn revert_unsent(
        &self,
        link_id: Uuid,
        thread_ids: &[Uuid],
        provider_message_ids: &[Uuid],
        write_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
}

/// Orchestrates a message-label batch and its best-effort provider publication.
pub struct MessageLabelService<R, Q, B> {
    /// Reads and writes the persisted label state.
    pub repository: R,
    /// Queues the provider operation after the transaction commits.
    pub enqueuer: Q,
    /// Publishes the affected threads' semantic events.
    pub broker: B,
}

impl<R, Q, B> MessageLabelService<R, Q, B>
where
    R: MessageLabelRepository,
    Q: EmailMessageEnqueuer,
    Q::Err: std::fmt::Debug,
    B: MacroEventBroker,
{
    /// Stage a label batch, publish its events, and queue or compensate the provider write.
    pub async fn change(
        &self,
        request: MessageLabelChange,
    ) -> Result<MessageLabelOutcome, MessageLabelError<R::Err>> {
        if request.message_ids.len() > MAX_MESSAGE_LABEL_BATCH {
            return Err(MessageLabelError::BatchSize);
        }
        let first_id = request
            .message_ids
            .first()
            .copied()
            .ok_or(MessageLabelError::BatchSize)?;
        let link = self
            .repository
            .inbox_for_message(&request.caller_macro_id, first_id)
            .await
            .map_err(MessageLabelError::InboxLookup)?
            .ok_or(MessageLabelError::MessageNotFound)?;
        let label = self
            .repository
            .label(request.label_id, link.id)
            .await
            .map_err(MessageLabelError::LabelLookup)?
            .ok_or(MessageLabelError::LabelNotFound)?;
        let db_messages = self
            .repository
            .messages(&request.message_ids, &request.caller_fusionauth_user_id)
            .await
            .map_err(MessageLabelError::MessagesLookup)?;
        let missing_ids: Vec<Uuid> = request
            .message_ids
            .iter()
            .filter(|&id| !db_messages.iter().any(|msg| msg.db_id == *id))
            .cloned()
            .collect();
        if !missing_ids.is_empty() {
            tracing::warn!(message_ids=?missing_ids, "unable to find messages in db");
        }
        let message_db_ids: Vec<Uuid> = db_messages.iter().map(|m| m.db_id).collect();
        let mut thread_ids: Vec<Uuid> = db_messages.iter().map(|m| m.thread_db_id).collect();
        thread_ids.sort_unstable();
        thread_ids.dedup();
        let pending_write_id = macro_uuid::generate_uuid_v7();
        let provider_label_id = label.provider_label_id.clone();
        let is_adding = request.add;
        let provider_messages = self
            .repository
            .stage(StagedLabelWrite {
                link_id: link.id,
                thread_ids: thread_ids.clone(),
                messages: db_messages,
                provider_label_id: provider_label_id.clone(),
                add: is_adding,
                write_id: pending_write_id,
            })
            .await?;

        let actor = Some(link.macro_id.clone());
        for thread_id in &thread_ids {
            let event = EmailMacroEvent::thread_label_change(
                link.id,
                link.macro_id.clone(),
                actor.clone(),
                *thread_id,
                LabelRef {
                    label_id: label.id,
                    provider_label_id: provider_label_id.clone(),
                    name: label.name.clone(),
                },
                is_adding,
                EmailEventOrigin::UserAction,
            );
            if let Some(event) = event {
                let _ = self.broker.send_event(&event).inspect_err(|e| {
                    tracing::error!(error=?e, "failed to publish email macro event");
                });
            }
        }

        let (labels_to_add, labels_to_remove) = if is_adding {
            (vec![provider_label_id.clone()], Vec::new())
        } else {
            (Vec::new(), vec![provider_label_id.clone()])
        };
        let provider_message_ids: Vec<Uuid> = provider_messages.iter().map(|(id, _)| *id).collect();
        let mut failed_ids = Vec::new();
        if !provider_messages.is_empty()
            && self
                .enqueuer
                .enqueue_gmail_ops_modify_labels_batch(
                    link.id,
                    provider_messages,
                    labels_to_add,
                    labels_to_remove,
                    pending_write_id,
                )
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "Failed to enqueue gmail ops label write");
                })
                .is_err()
        {
            failed_ids = self
                .repository
                .revert_unsent(
                    link.id,
                    &thread_ids,
                    &provider_message_ids,
                    pending_write_id,
                )
                .await
                .map_err(MessageLabelError::Unqueued)?;
        }

        Ok(MessageLabelOutcome {
            successful_ids: message_db_ids
                .into_iter()
                .filter(|id| !failed_ids.contains(id))
                .collect(),
            failed_ids,
            missing_ids,
        })
    }
}

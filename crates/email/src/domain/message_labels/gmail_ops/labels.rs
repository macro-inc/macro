//! Pending-write ordering and provider settlement for queued label changes.

use super::error_policy::is_permanent_mutation_error;
use super::{
    GmailLabelWrites, GmailMailboxOperations, GmailOpsLinks, GmailOpsRetryQueue, GmailOpsService,
    LabelWriteRevert, LabelWriteTurn, RevertedMessageFlag,
};
use crate::domain::mailbox::connection::ConnectionSourceError;
use email_api_client::domain::{models::EmailApiError, service::SEPARATE_LABEL_WRITES_BELOW};
use futures::future::BoxFuture;
use models_email::gmail::gmail_ops::{GmailMessageRef, ModifyMessageLabelsBatchPayload};
use models_email::service::{self, link::Link};
use uuid::Uuid;

/// Why a gmail_ops operation did not finish.
#[derive(Debug)]
pub enum OperationError {
    Gmail(EmailApiError),
    /// Recording the operation's outcome failed. Gmail writes are idempotent,
    /// so the operation runs again.
    Database(anyhow::Error),
    /// A newer label write on one of the operation's messages is still on its
    /// way. If Gmail rejects it, this one has to send after all.
    WaitingForNewerWrite,
}

impl From<EmailApiError> for OperationError {
    fn from(error: EmailApiError) -> Self {
        Self::Gmail(error)
    }
}

/// Modifies labels for a batch of messages. A message whose newer write was
/// confirmed is left out. The messages the write is the newest on are sent
/// first; one whose newer write is still on its way then makes the operation
/// wait for it. Sending first means two writes that are each newer on one of
/// the other's messages never wait for each other. From ten messages up the
/// messages sent are one Gmail request, which a permanent failure reverts as
/// a whole, with the waiting messages. Below ten, each message is its own
/// request and is settled as Gmail answers it (see [`send_one_at_a_time`]).
/// A message Gmail no longer has is skipped; transient errors (5xx, network)
/// and rate limits keep the optimistic DB changes for the retry.
///
/// Boxed so this large future lives on the heap rather than in the frames
/// that await it: unoptimized builds give every awaited future its own stack
/// slot, and the gmail_ops dispatch awaits it in two places, deep enough to
/// overflow a worker thread's stack in a local build.
pub fn modify_message_labels<'a, R, G, Q>(
    ctx: &'a GmailOpsService<R, G, Q>,
    link: &'a Link,
    payload: &'a ModifyMessageLabelsBatchPayload,
) -> BoxFuture<'a, Result<(), OperationError>>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    Box::pin(modify_message_labels_unboxed(ctx, link, payload))
}

#[tracing::instrument(
    skip(ctx, link, payload),
    fields(
        message_count = payload.messages.len(),
        labels_to_add = ?payload.labels_to_add,
        labels_to_remove = ?payload.labels_to_remove,
    ),
    err(Debug)
)]
async fn modify_message_labels_unboxed<R, G, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    payload: &ModifyMessageLabelsBatchPayload,
) -> Result<(), OperationError>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    let Some(write_id) = payload.pending_write_id else {
        // Queued before markers existed: nothing to coordinate with.
        let messages: Vec<&GmailMessageRef> = payload.messages.iter().collect();
        return send(ctx, link, payload, &messages, &[]).await;
    };

    let message_ids: Vec<Uuid> = payload
        .messages
        .iter()
        .map(|message| message.db_message_id)
        .collect();
    let turns = label_write_turns(&ctx.repository, payload, &message_ids, write_id).await?;
    let ids_with = |turn: LabelWriteTurn| -> Vec<Uuid> {
        payload
            .messages
            .iter()
            .map(|message| message.db_message_id)
            .filter(|id| turns.get(id).copied().unwrap_or(LabelWriteTurn::Superseded) == turn)
            .collect()
    };
    abandon_superseded(ctx, link, &ids_with(LabelWriteTurn::Superseded), write_id).await?;

    let mut waiting = ids_with(LabelWriteTurn::Wait);
    let messages: Vec<&GmailMessageRef> = payload
        .messages
        .iter()
        .filter(|message| turns.get(&message.db_message_id) == Some(&LabelWriteTurn::Send))
        .collect();
    if messages.len() >= SEPARATE_LABEL_WRITES_BELOW {
        send(ctx, link, payload, &messages, &waiting).await?;
    } else if !messages.is_empty() {
        send_one_at_a_time(ctx, link, payload, write_id, &messages, &mut waiting).await?;
    }

    if !waiting.is_empty() {
        tracing::info!(
            db_message_ids = ?waiting,
            "Newer label writes on these messages are still on their way, waiting for them"
        );
        return Err(OperationError::WaitingForNewerWrite);
    }
    if messages.is_empty() {
        tracing::info!("Newer label writes took over every message, skipping Gmail");
    }
    Ok(())
}

async fn label_write_turns<R: GmailLabelWrites>(
    db: &R,
    payload: &ModifyMessageLabelsBatchPayload,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<std::collections::HashMap<Uuid, LabelWriteTurn>, OperationError> {
    let provider_label_ids: Vec<String> = payload
        .labels_to_add
        .iter()
        .chain(&payload.labels_to_remove)
        .cloned()
        .collect();
    db.turns(message_ids, &provider_label_ids, write_id)
        .await
        .map_err(|error| {
            OperationError::Database(
                error
                    .into_original()
                    .context("Failed to read the label write's turn"),
            )
        })
}

/// Drops the write's rows on messages a newer write has taken over.
async fn abandon_superseded<R, G, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<(), OperationError>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    if message_ids.is_empty() {
        return Ok(());
    }
    ctx.repository
        .abandon(link.id, message_ids, write_id)
        .await
        .map_err(|error| OperationError::Database(error.into_original()))
}

/// Clears the write's markers on messages Gmail accepted it for. Inbox sync
/// applies Gmail's labels to them again; failing here retries the operation
/// rather than leaving sync off those labels until the markers expire.
async fn confirm<R, G, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<(), OperationError>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    ctx.repository
        .confirm(link.id, message_ids, write_id)
        .await
        .map_err(|error| OperationError::Database(error.into_original()))
}

/// Sends `messages` one Gmail request each, settling each message as Gmail
/// answers it. Before each request after the first, the message's turn is
/// read again: a message a newer write took over meanwhile is skipped, and
/// one with a newer write still on its way joins `waiting`. A permanent
/// rejection reverts the rejected message, those not sent yet and the waiting
/// ones; messages Gmail accepted keep their change. A retry finds the
/// accepted messages settled and doesn't send them again. Boxed for the
/// reason given on [`modify_message_labels`].
fn send_one_at_a_time<'a, R, G, Q>(
    ctx: &'a GmailOpsService<R, G, Q>,
    link: &'a Link,
    payload: &'a ModifyMessageLabelsBatchPayload,
    write_id: Uuid,
    messages: &'a [&'a GmailMessageRef],
    waiting: &'a mut Vec<Uuid>,
) -> BoxFuture<'a, Result<(), OperationError>>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    Box::pin(send_one_at_a_time_unboxed(
        ctx, link, payload, write_id, messages, waiting,
    ))
}

async fn send_one_at_a_time_unboxed<R, G, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    payload: &ModifyMessageLabelsBatchPayload,
    write_id: Uuid,
    messages: &[&GmailMessageRef],
    waiting: &mut Vec<Uuid>,
) -> Result<(), OperationError>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    // As in a batch request, a message Gmail no longer has counts as written
    // when the write has others.
    let skip_missing = payload.messages.len() > 1;
    for (index, message) in messages.iter().enumerate() {
        let message_id = message.db_message_id;
        if index > 0 {
            let turns =
                label_write_turns(&ctx.repository, payload, &[message_id], write_id).await?;
            match turns
                .get(&message_id)
                .copied()
                .unwrap_or(LabelWriteTurn::Superseded)
            {
                LabelWriteTurn::Send => {}
                LabelWriteTurn::Superseded => {
                    abandon_superseded(ctx, link, &[message_id], write_id).await?;
                    continue;
                }
                LabelWriteTurn::Wait => {
                    waiting.push(message_id);
                    continue;
                }
            }
        }
        let result = ctx
            .gmail
            .modify_one_message_labels(
                link.id,
                &message.provider_message_id,
                &payload.labels_to_add,
                &payload.labels_to_remove,
                skip_missing,
            )
            .await;
        match result {
            Ok(()) => confirm(ctx, link, &[message_id], write_id).await?,
            Err(error) if is_permanent_mutation_error(&error) => {
                let unaccepted: Vec<Uuid> = messages[index..]
                    .iter()
                    .map(|message| message.db_message_id)
                    .chain(waiting.iter().copied())
                    .collect();
                tracing::error!(
                    error = ?error,
                    db_message_ids = ?unaccepted,
                    "Permanent Gmail error modifying labels, reverting the messages Gmail hasn't accepted"
                );
                revert_db_changes(&ctx.repository, link, payload, unaccepted)
                    .await
                    .map_err(OperationError::Database)?;
                return Err(OperationError::Gmail(error));
            }
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    db_message_id = %message_id,
                    "Retryable Gmail error modifying labels, preserving optimistic database changes"
                );
                return Err(OperationError::Gmail(error));
            }
        }
    }
    Ok(())
}

/// Sends `messages` to Gmail in one call and records the outcome. A permanent
/// failure reverts them and the `waiting` messages. Boxed for the reason
/// given on [`modify_message_labels`]: the operation awaits it in two places.
fn send<'a, R, G, Q>(
    ctx: &'a GmailOpsService<R, G, Q>,
    link: &'a Link,
    payload: &'a ModifyMessageLabelsBatchPayload,
    messages: &'a [&'a GmailMessageRef],
    waiting: &'a [Uuid],
) -> BoxFuture<'a, Result<(), OperationError>>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    Box::pin(send_unboxed(ctx, link, payload, messages, waiting))
}

async fn send_unboxed<R, G, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    payload: &ModifyMessageLabelsBatchPayload,
    messages: &[&GmailMessageRef],
    waiting: &[Uuid],
) -> Result<(), OperationError>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    let db_message_ids: Vec<Uuid> = messages
        .iter()
        .map(|message| message.db_message_id)
        .collect();
    let provider_message_ids: Vec<String> = messages
        .iter()
        .map(|message| message.provider_message_id.clone())
        .collect();
    let result = ctx
        .gmail
        .modify_message_labels(
            link.id,
            &provider_message_ids,
            &payload.labels_to_add,
            &payload.labels_to_remove,
        )
        .await;

    match result {
        Ok(()) => {
            if let Some(write_id) = payload.pending_write_id {
                confirm(ctx, link, &db_message_ids, write_id).await?;
            }
            Ok(())
        }
        Err(error) if is_permanent_mutation_error(&error) => {
            let unaccepted: Vec<Uuid> = db_message_ids.iter().chain(waiting).copied().collect();
            tracing::error!(
                error = ?error,
                db_message_ids = ?unaccepted,
                "Permanent Gmail error modifying labels, reverting database changes"
            );
            revert_db_changes(&ctx.repository, link, payload, unaccepted)
                .await
                .map_err(OperationError::Database)?;
            Err(OperationError::Gmail(error))
        }
        Err(error) => {
            tracing::warn!(
                error = ?error,
                ?db_message_ids,
                "Retryable Gmail error modifying labels, preserving optimistic database changes"
            );
            Err(OperationError::Gmail(error))
        }
    }
}

/// Retain the legacy inverse while persistence owns the indivisible transaction.
async fn revert_db_changes<R: GmailLabelWrites>(
    repository: &R,
    link: &Link,
    payload: &ModifyMessageLabelsBatchPayload,
    sent_ids: Vec<Uuid>,
) -> anyhow::Result<()> {
    let change = match payload.pending_write_id {
        Some(write_id) => LabelWriteRevert::Pending(write_id),
        None => {
            let is_adding = !payload.labels_to_add.is_empty();
            let label = if is_adding {
                payload.labels_to_add.first()
            } else {
                payload.labels_to_remove.first()
            };
            match label {
                None => LabelWriteRevert::NoLabel,
                Some(label) => LabelWriteRevert::Legacy {
                    provider_label_id: label.clone(),
                    was_adding: is_adding,
                    flag: if *label == service::label::system_labels::UNREAD {
                        RevertedMessageFlag::Read(is_adding)
                    } else if *label == service::label::system_labels::STARRED {
                        RevertedMessageFlag::Starred(!is_adding)
                    } else {
                        RevertedMessageFlag::None
                    },
                },
            }
        }
    };
    let reverted_ids = repository
        .revert(link.id, sent_ids, change)
        .await
        .map_err(ConnectionSourceError::into_original)?;
    tracing::info!(
        db_message_ids = ?reverted_ids,
        "Successfully reverted database changes after Gmail API failure"
    );
    Ok(())
}

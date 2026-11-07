//! The queued half of optimistic Gmail message-label writes.

mod error_policy;
mod labels;
mod operations;
mod ports;
#[cfg(test)]
mod test;

pub use labels::{OperationError, modify_message_labels};
pub use ports::*;

use crate::domain::mailbox::connection::ConnectionSourceError;
use anyhow::anyhow;
use models_email::gmail::gmail_ops::{GmailOpsOperation, GmailOpsPubsubMessage};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Logging policy already decided by the domain for a terminal delivery.
#[derive(Clone, Copy)]
pub enum GmailOpsFailureLog {
    /// A new retry-queue message carries the operation forward.
    Deferred,
    /// The operation was rejected permanently.
    Permanent,
}

impl GmailOpsFailureLog {
    /// Emit the legacy event inside the listener's acknowledgement span.
    pub fn record(self, data: &GmailOpsPubsubMessage, e: &DetailedError) {
        match self {
            Self::Deferred => {
                tracing::debug!(error = ?e, payload = ?data.operation, "Deferred gmail ops message moved to the retry queue. The message will be deleted.");
            }
            Self::Permanent => {
                tracing::error!(error = ?e, payload = ?data.operation, "Non-retryable error processing gmail ops message. The message will be deleted.");
            }
        }
    }
}

/// Final action for the inbound adapter, including the original error values.
pub enum GmailOpsDisposition {
    /// Processing succeeded; delete the delivery and return its acknowledgement result.
    DoneDelete,
    /// An invalid body must be deleted best-effort; return this decoding error regardless.
    InvalidDelete(anyhow::Error),
    /// Delete a completed/rejected operation, retaining its existing failure span and event.
    FailureDelete {
        /// Original decoded operation for the existing span fields.
        data: GmailOpsPubsubMessage,
        /// Original classified failure, including its prefixed source.
        error: DetailedError,
        /// Event policy chosen by the domain.
        log: GmailOpsFailureLog,
    },
    /// Leave the delivery for redelivery and return success to the consumer loop.
    LeaveForRedelivery {
        /// Original decoded operation for the existing event.
        data: GmailOpsPubsubMessage,
        /// Original classified failure for the existing event.
        error: DetailedError,
    },
}

/// Processes a delivered Gmail operation through persistence, provider, and retry ports.
pub struct GmailOpsService<R, G, Q> {
    /// Inbox facts and pending-label settlements.
    pub repository: R,
    /// Provider calls with their existing token lookup and admission gate.
    pub gmail: G,
    /// The existing Gmail operations retry queue.
    pub retry_queue: Q,
    /// Whether the delivered message is already on the retry queue.
    pub retry_worker: bool,
}

impl<R, G, Q> GmailOpsService<R, G, Q>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    /// Decide the delivery's outcome, including malformed bodies and retry routing.
    pub async fn process(
        &self,
        extracted: anyhow::Result<GmailOpsPubsubMessage>,
    ) -> GmailOpsDisposition {
        let data = match extracted {
            Ok(data) => data,
            Err(e) => {
                tracing::error!(error = %e, "Failed to extract gmail ops message, this is non-retryable.");
                return GmailOpsDisposition::InvalidDelete(e);
            }
        };
        match inner_process_message(self, &data).await {
            Ok(()) => GmailOpsDisposition::DoneDelete,
            Err(ProcessingError::NonRetryable(error)) => {
                let log = if matches!(
                    error.reason,
                    FailureReason::GmailApiRateLimited
                        | FailureReason::GmailApiUnavailable
                        | FailureReason::NewerLabelWritePending
                ) {
                    GmailOpsFailureLog::Deferred
                } else {
                    GmailOpsFailureLog::Permanent
                };
                GmailOpsDisposition::FailureDelete { data, error, log }
            }
            Err(ProcessingError::Retryable(error)) => {
                GmailOpsDisposition::LeaveForRedelivery { data, error }
            }
        }
    }
}

#[tracing::instrument(skip(ctx, data), err)]
async fn inner_process_message<R, G, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    data: &GmailOpsPubsubMessage,
) -> Result<(), ProcessingError>
where
    R: GmailOpsLinks + GmailLabelWrites,
    G: GmailMailboxOperations,
    Q: GmailOpsRetryQueue,
{
    let link = ctx
        .repository
        .link(data.link_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch link from database"),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::LinkNotFound,
                source: anyhow!("No link found for id {}", data.link_id),
            })
        })?;

    let (operation_name, operation_result) = match &data.operation {
        GmailOpsOperation::ModifyMessageLabels(payload) => (
            "modify_message_labels",
            labels::modify_message_labels(ctx, &link, &payload.clone().into()).await,
        ),
        GmailOpsOperation::ModifyMessageLabelsBatch(payload) => (
            "modify_message_labels",
            labels::modify_message_labels(ctx, &link, payload).await,
        ),
        GmailOpsOperation::DeleteLabel(payload) => (
            "delete_label",
            operations::delete_label(ctx, &link, payload)
                .await
                .map_err(Into::into),
        ),
        GmailOpsOperation::BlockSender(payload) => (
            "block_sender",
            operations::block_sender(ctx, &link, payload)
                .await
                .map_err(Into::into),
        ),
        GmailOpsOperation::UnblockSender(payload) => (
            "unblock_sender",
            operations::unblock_sender(ctx, &link, payload)
                .await
                .map_err(Into::into),
        ),
    };
    if let Err(error) = operation_result {
        let processing_error = match error {
            labels::OperationError::Gmail(error) => {
                error_policy::handle_email_api_error(ctx, data, error).await
            }
            labels::OperationError::Database(source) => ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source,
            }),
            labels::OperationError::WaitingForNewerWrite => wait_in_retry_queue(ctx, data).await,
        };
        return Err(prefix_error_source(processing_error, operation_name));
    }
    tracing::debug!(operation_name, "Successfully processed Gmail operation");
    Ok(())
}

async fn wait_in_retry_queue<R, G, Q: GmailOpsRetryQueue>(
    ctx: &GmailOpsService<R, G, Q>,
    data: &GmailOpsPubsubMessage,
) -> ProcessingError {
    let waiting = || DetailedError {
        reason: FailureReason::NewerLabelWritePending,
        source: anyhow!("a newer label write on its messages is still on its way"),
    };
    if ctx.retry_worker {
        return ProcessingError::Retryable(waiting());
    }
    if let Err(enqueue_error) = ctx.retry_queue.enqueue(data.clone()).await {
        return ProcessingError::Retryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: enqueue_error
                .into_original()
                .context("Failed to enqueue gmail ops retry message"),
        });
    }
    ProcessingError::NonRetryable(waiting())
}

fn prefix_error_source(error: ProcessingError, operation_name: &str) -> ProcessingError {
    match error {
        ProcessingError::Retryable(DetailedError { reason, source }) => {
            ProcessingError::Retryable(DetailedError {
                reason,
                source: anyhow!("{}: {}", operation_name, source),
            })
        }
        ProcessingError::NonRetryable(DetailedError { reason, source }) => {
            ProcessingError::NonRetryable(DetailedError {
                reason,
                source: anyhow!("{}: {}", operation_name, source),
            })
        }
    }
}

/// Emit the retry event under the listener's unchanged retryable-error span.
pub fn record_retryable_error(data: &GmailOpsPubsubMessage, e: &DetailedError) {
    tracing::debug!(error = ?e, payload = ?data.operation, "Retryable error processing gmail ops message.");
}

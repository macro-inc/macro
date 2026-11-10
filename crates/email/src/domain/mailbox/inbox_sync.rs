//! Admission, reconciliation and delivery dispositions for Gmail inbox updates.

mod delete_message;
mod error_policy;
mod label_writes;
mod pending_labels;
mod ports;
#[cfg(test)]
mod test;
mod update_labels;

pub use error_policy::handle_operation_error;
pub use pending_labels::PendingAroundRead;
pub use ports::*;

use super::connection::ConnectionSourceError;
use crate::domain::events::EmailMacroEvent;
use crate::domain::message_labels::gmail_ops::GmailOpsLinks;
use anyhow::anyhow;
use delete_message::delete_message;
use macro_event_broker::MacroEventBroker;
use models_email::gmail::inbox_sync::{InboxSyncOperation, InboxSyncPubsubMessage};
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use std::result;
use update_labels::update_labels;

/// Final action for a decoded or malformed delivery.
pub enum InboxSyncDisposition {
    /// The operation completed or was intentionally skipped.
    DoneDelete,
    /// Delete best-effort and return this original decoding failure.
    InvalidDelete(anyhow::Error),
    /// Delete the delivery under the existing terminal-error span.
    FailureDelete {
        /// Original decoded operation for the existing span and event fields.
        data: InboxSyncPubsubMessage,
        /// Original classified failure.
        error: DetailedError,
        /// Domain-selected terminal event.
        log: InboxSyncFailureLog,
    },
    /// Retain the delivery for redelivery and return success to the worker loop.
    LeaveForRedelivery {
        /// Original decoded operation for the existing span and event fields.
        data: InboxSyncPubsubMessage,
        /// Original retryable failure.
        error: DetailedError,
    },
}

/// Logging decision emitted inside the listener's terminal acknowledgement span.
#[derive(Clone, Copy)]
pub enum InboxSyncFailureLog {
    /// A refused operation has already been enqueued for retry.
    Deferred,
    /// A terminal failure gives up this delivery.
    Permanent,
}

impl InboxSyncFailureLog {
    /// Preserve the original event's Display error and Debug payload.
    pub fn record(self, data: &InboxSyncPubsubMessage, e: &DetailedError) {
        match self {
            Self::Deferred => {
                tracing::debug!(error = %e, payload = format!("{:?}", data.operation), "Rate-limited inbox sync message deferred. The message will be deleted.");
            }
            Self::Permanent => {
                tracing::error!(error = %e, payload = format!("{:?}", data.operation), "Non-retryable error processing inbox sync message. The message will be deleted.");
            }
        }
    }
}

/// Processes inbox updates through the original provider and persistence boundaries.
pub struct InboxSyncService<L, R, G, Q, E> {
    /// Existing delivered-inbox lookup.
    pub links: L,
    /// Stored message facts and atomic changes.
    pub repository: R,
    /// Gmail reads through the existing admission gate.
    pub gmail: G,
    /// Primary and retry publication.
    pub queue: Q,
    /// Existing event broker and best-effort refresh.
    pub effects: E,
    /// Whether the delivery came from the retry queue.
    pub retry_worker: bool,
}

impl<L, R, G, Q, E> InboxSyncService<L, R, G, Q, E>
where
    L: GmailOpsLinks,
    R: InboxSyncRepository,
    G: InboxSyncGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher,
{
    /// Decide admission, processing, and the listener's acknowledgement action.
    pub async fn process<H: LegacyInboxSync>(
        &self,
        extracted: anyhow::Result<InboxSyncPubsubMessage>,
        legacy: &H,
    ) -> InboxSyncDisposition {
        let data = match extracted {
            Ok(data) => data,
            Err(e) => {
                tracing::error!(error = %e, "Failed to extract message, this is non-retryable.");
                return InboxSyncDisposition::InvalidDelete(e);
            }
        };
        match inner_process_message(self, &data, legacy).await {
            Ok(()) => InboxSyncDisposition::DoneDelete,
            Err(ProcessingError::NonRetryable(error)) => {
                let log = if error.reason == FailureReason::GmailApiRateLimited {
                    InboxSyncFailureLog::Deferred
                } else {
                    InboxSyncFailureLog::Permanent
                };
                InboxSyncDisposition::FailureDelete { data, error, log }
            }
            Err(ProcessingError::Retryable(error)) => {
                InboxSyncDisposition::LeaveForRedelivery { data, error }
            }
        }
    }
}

#[tracing::instrument(skip(ctx, legacy))]
async fn inner_process_message<L, R, G, Q, E, H>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    data: &InboxSyncPubsubMessage,
    legacy: &H,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncRepository,
    G: InboxSyncGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher,
    H: LegacyInboxSync,
{
    let link = ctx
        .links
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

    if !should_process(&link, &data.operation) {
        tracing::debug!(
            link_id = %link.id,
            is_sync_active = link.is_sync_active,
            needs_reauth = link.needs_reauth,
            "Skipping inbox sync operation for link"
        );
        return Ok(());
    }

    match &data.operation {
        InboxSyncOperation::GmailMessage(payload) => {
            legacy
                .gmail_message(&link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "gmail_message"))?;
            tracing::debug!("Successfully processed gmail message operation");
        }
        InboxSyncOperation::UpsertMessage(payload) => {
            legacy
                .upsert_message(&link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "upsert_message"))?;
            tracing::debug!("Successfully processed upsert message operation");
        }
        InboxSyncOperation::DeleteMessage(payload) => {
            delete_message(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "delete_message"))?;
            tracing::debug!("Successfully processed delete message operation");
        }
        InboxSyncOperation::UpdateLabels(payload) => {
            update_labels(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "remove_labels"))?;
            tracing::debug!("Successfully processed update labels operation");
        }
    }

    Ok(())
}

/// Whether inbox sync should process `operation` for `link`.
///
/// Gmail notifications for a link that needs reauth are skipped: listing their
/// changes needs the dead grant, and the untouched sync cursor lets the first
/// notification after the grant recovers catch up. Operations fanned out by an
/// earlier notification still run because the cursor has already moved past
/// them.
fn should_process(link: &Link, operation: &InboxSyncOperation) -> bool {
    match operation {
        InboxSyncOperation::GmailMessage(_) => link.is_sync_active && !link.needs_reauth,
        InboxSyncOperation::UpsertMessage(_)
        | InboxSyncOperation::DeleteMessage(_)
        | InboxSyncOperation::UpdateLabels(_) => link.is_sync_active,
    }
}

/// Adds an operation name prefix to a ProcessingError's source field
fn prefix_error_source(error: ProcessingError, operation_name: &str) -> ProcessingError {
    match error {
        ProcessingError::Retryable(DetailedError { reason, source }) => {
            ProcessingError::Retryable(DetailedError {
                reason,
                source: anyhow::anyhow!("{}: {}", operation_name, source),
            })
        }
        ProcessingError::NonRetryable(DetailedError { reason, source }) => {
            ProcessingError::NonRetryable(DetailedError {
                reason,
                source: anyhow::anyhow!("{}: {}", operation_name, source),
            })
        }
    }
}

/// Emit the retry event under the listener's existing handler span.
pub fn record_retryable_error(data: &InboxSyncPubsubMessage, e: &DetailedError) {
    tracing::debug!(error = %e, payload = format!("{:?}", data.operation), "Retryable error processing inbox sync message.");
}

fn publish_email_event<B: MacroEventBroker>(broker: &B, event: &EmailMacroEvent) {
    let _ = broker
        .send_event(event)
        .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));
}

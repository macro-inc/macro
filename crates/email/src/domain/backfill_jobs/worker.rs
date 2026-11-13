//! Admission, operation policy, and delivery outcomes for the Gmail backfill worker.

mod attachment;
mod completion;
mod counters;
mod crm;
mod crm_contact;
mod crm_contact_delete;
mod crm_user;
mod crm_user_delete;
mod deferral;
mod email_api_error;
mod error_policy;
mod followups;
mod import_ports;
mod init;
mod initialization;
mod lifecycle_ports;
mod listing;
mod message;
mod metadata;
mod ports;
mod process;
mod seed;
#[cfg(test)]
mod test;
mod threads;
mod write_slot;

pub use deferral::{rate_limit, redelivery_delay_seconds};
pub use email_api_error::map_email_api_error;
pub use error_policy::handle_retryable_error;
pub use import_ports::*;
pub use lifecycle_ports::*;
pub use metadata::{is_unstorable_sqlstate, map_db_error};
pub use ports::*;
pub use write_slot::admit_write_slot;

use models_email::service::backfill::BackfillPubsubMessage;
use models_email::service::pubsub::{DetailedError, ProcessingError};
use std::time::Duration;

/// The acknowledgement chosen for one delivered operation.
pub enum BackfillDisposition {
    /// Completed or intentionally skipped.
    DoneDelete,
    /// Run terminal accounting and delete under the existing failure span.
    FailureDelete(DetailedError),
    /// Republish with a delay under the existing deferral span.
    Defer {
        error: DetailedError,
        retry_after: Option<Duration>,
    },
    /// Leave the delivery for the queue's visibility timeout.
    LeaveForRedelivery(DetailedError),
}

/// Result of trying to publish a deferred operation.
pub enum BackfillDeferral {
    /// A replacement was sent; acknowledge the original.
    Delete,
    /// Publication failed; leave the original for redelivery.
    LeaveForRedelivery,
}

/// Backfill policy over storage, provider, queue, effects and CRM capabilities.
pub struct BackfillService<R, G, Q, E, C> {
    /// Stored facts and metadata transactions.
    pub repository: R,
    /// Existing provider reads, including admission and token lookup.
    pub gmail: G,
    /// Operation publication.
    pub queue: Q,
    /// Progress, uploads, contacts, and refresh capabilities.
    pub effects: E,
    /// CRM domain service capabilities.
    pub crm: C,
    /// Compile-time contact-seed switch captured at composition.
    pub contacts_sync: bool,
    /// Import supported attachments, captured at composition.
    pub attachment_upload: bool,
}

impl<R, G, Q, E, C> BackfillService<R, G, Q, E, C>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    /// Classify a transport decoder's result without changing its error.
    pub fn decode(
        &self,
        extracted: anyhow::Result<BackfillPubsubMessage>,
    ) -> anyhow::Result<BackfillPubsubMessage> {
        extracted.map_err(|e| {
            tracing::error!(error = %e, "Failed to extract message, this is non-retryable.");
            e
        })
    }

    /// Run admission and the operation, returning the listener's named action.
    pub async fn process(&self, data: &BackfillPubsubMessage) -> BackfillDisposition {
        match process::inner_process_message(self, data).await {
            Ok(()) => BackfillDisposition::DoneDelete,
            Err(ProcessingError::NonRetryable(e)) => BackfillDisposition::FailureDelete(e),
            Err(ProcessingError::Retryable(e)) => match rate_limit(&e) {
                Some(retry_after) => BackfillDisposition::Defer {
                    error: e,
                    retry_after,
                },
                None => BackfillDisposition::LeaveForRedelivery(e),
            },
        }
    }

    /// Apply terminal accounting inside the listener's existing acknowledgement span.
    pub async fn terminal(
        &self,
        data: &BackfillPubsubMessage,
        error: &DetailedError,
    ) -> anyhow::Result<()> {
        error_policy::handle_non_retryable_error(self, data, error).await
    }

    /// Republish inside the listener's existing deferral span.
    pub async fn defer(
        &self,
        data: &BackfillPubsubMessage,
        error: &DetailedError,
        deferrals: u32,
        retry_after: Option<Duration>,
    ) -> anyhow::Result<BackfillDeferral> {
        error_policy::defer_rate_limited_operation(self, data, error, deferrals, retry_after).await
    }
}

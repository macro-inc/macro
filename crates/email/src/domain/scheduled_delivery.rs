//! Fenced delivery and recovery. An uncertain provider submission is reconciled,
//! never automatically repeated. No database lock spans provider work.

use std::time::Instant;
use uuid::Uuid;

/// Approved attachment identity checks shared by delivery adapters.
pub mod attachments;
/// Recovery scanning and queue notification policy.
pub mod recovery;

/// A worker must renew ownership before crossing the provider boundary.
pub const DELIVERY_LEASE_SECONDS: i32 = 300;
/// Failed lookups and negative searches may be retried without resending mail.
pub const RECONCILIATION_DELAY_SECONDS: i32 = 300;
/// Back off failures that occurred before any provider submission.
pub const PREPARATION_RETRY_SECONDS: i32 = 60;

/// Work permitted by a newly acquired delivery claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryMode {
    /// No provider submission has begun; preparation and delivery are safe.
    Send,
    /// Submission may have succeeded; only provider lookup is safe.
    Reconcile,
}

/// Opaque repository ownership plus the domain action it permits.
pub struct ClaimedDelivery<C> {
    /// Fenced persistence receipt and provider context.
    pub claim: C,
    /// Whether this invocation may send or must reconcile an earlier send.
    pub mode: DeliveryMode,
}

/// Recoverable states that stop automatic provider submission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryPause {
    /// Preparation or explicit provider rejection failed; cancellation is safe.
    Failed,
    /// Provider acceptance could not be established; cancellation cannot be promised.
    Unconfirmed,
}

/// Preparation has no provider send side effects.
#[derive(Debug, thiserror::Error)]
pub enum PreparationError {
    /// A temporary failure before submission may be retried safely.
    #[error(transparent)]
    Retry(anyhow::Error),
    /// The user must review the message, attachments, or account before retrying.
    #[error(transparent)]
    Failed(anyhow::Error),
}

/// A failed send response must retain whether delivery might have occurred.
#[derive(Debug, thiserror::Error)]
pub enum SubmissionError {
    /// The provider explicitly refused the send without accepting it.
    #[error(transparent)]
    Rejected(anyhow::Error),
    /// A timeout, failed response, or ambiguous provider error needs reconciliation.
    #[error(transparent)]
    Uncertain(anyhow::Error),
}

/// Claim acquisition and all writes are fenced against stale workers.
pub trait ScheduledDeliveryRepo: Sync {
    /// Proof of ownership, including provider context.
    type Claim: Send + Sync;
    /// Provider result consumed by completion persistence.
    type Sent: Send;

    /// Apply or retire a deferred message deletion only after delivery authority
    /// resolves; preserve it while Send/reconciliation still needs the message.
    fn reconcile_deletion(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Acquire an available or expired claim, committing before returning.
    fn try_claim(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<ClaimedDelivery<Self::Claim>>>> + Send;
    /// Persist the submission boundary only while this claim is live.
    fn begin_send(&self, claim: &Self::Claim) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Persist successful delivery only while this receipt still owns the claim.
    fn complete(
        &self,
        claim: &Self::Claim,
        sent: Self::Sent,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Release preparation that never submitted, with a retry delay.
    fn release(&self, claim: &Self::Claim) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Persist a failure or uncertain outcome without granting permission to resend.
    fn pause(
        &self,
        claim: &Self::Claim,
        reason: DeliveryPause,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Provider work is separated at the point where a send can have side effects.
pub trait ScheduledMessageSender<Claim, Sent>: Sync {
    /// Validated MIME, attachments and credentials, prepared without sending.
    type Prepared: Send;
    /// Load and validate all content and credentials before marking submission.
    fn prepare(
        &self,
        claim: &Claim,
    ) -> impl Future<Output = Result<Self::Prepared, PreparationError>> + Send;
    /// Submit exactly once. The caller has already durably recorded submission.
    fn send_prepared(
        &self,
        claim: &Claim,
        prepared: Self::Prepared,
    ) -> impl Future<Output = Result<Sent, SubmissionError>> + Send;
    /// Find a previously submitted message by its persisted Message-ID.
    fn reconcile(&self, claim: &Claim)
    -> impl Future<Output = anyhow::Result<Option<Sent>>> + Send;
}

/// Deliver or reconcile one queue item. No failure after the submission boundary
/// can release delivery authority for another automatic send.
#[tracing::instrument(skip(repo, sender), fields(phase = tracing::field::Empty, mode = tracing::field::Empty), err)]
pub async fn deliver_scheduled<R, S>(
    repo: &R,
    sender: &S,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<()>
where
    R: ScheduledDeliveryRepo,
    S: ScheduledMessageSender<R::Claim, R::Sent>,
{
    tracing::Span::current().record("phase", "deferred_deletion");
    repo.reconcile_deletion(link_id, message_id).await?;
    tracing::Span::current().record("phase", "claim");
    let Some(ClaimedDelivery { claim, mode }) = repo.try_claim(link_id, message_id).await? else {
        return Ok(());
    };
    tracing::Span::current().record("mode", tracing::field::debug(mode));
    if mode == DeliveryMode::Reconcile {
        tracing::Span::current().record("phase", "reconcile");
        let started = Instant::now();
        return match sender.reconcile(&claim).await {
            Ok(Some(sent)) => {
                tracing::info!(
                    event = "email_send.reconciliation",
                    outcome = "found",
                    duration_ms = started.elapsed().as_millis() as u64,
                    "prior provider submission found"
                );
                tracing::Span::current().record("phase", "complete");
                repo.complete(&claim, sent).await
            }
            Ok(None) => {
                tracing::info!(
                    event = "email_send.reconciliation",
                    outcome = "not_found",
                    retry_delay_secs = RECONCILIATION_DELAY_SECONDS,
                    duration_ms = started.elapsed().as_millis() as u64,
                    "delivery remains unconfirmed"
                );
                tracing::Span::current().record("phase", "pause");
                repo.pause(&claim, DeliveryPause::Unconfirmed).await
            }
            Err(error) => {
                tracing::warn!(
                    event = "email_send.reconciliation",
                    outcome = "error",
                    retry_delay_secs = RECONCILIATION_DELAY_SECONDS,
                    duration_ms = started.elapsed().as_millis() as u64,
                    "provider lookup failed; delivery remains unconfirmed"
                );
                repo.pause(&claim, DeliveryPause::Unconfirmed).await?;
                Err(error)
            }
        };
    }
    tracing::Span::current().record("phase", "prepare");
    let started = Instant::now();
    let prepared = match sender.prepare(&claim).await {
        Ok(prepared) => {
            tracing::info!(
                event = "email_send.preparation",
                outcome = "ready",
                duration_ms = started.elapsed().as_millis() as u64,
                "email preparation completed"
            );
            prepared
        }
        Err(PreparationError::Retry(error)) => {
            tracing::warn!(
                event = "email_send.preparation",
                outcome = "retry",
                retry_delay_secs = PREPARATION_RETRY_SECONDS,
                duration_ms = started.elapsed().as_millis() as u64,
                "email preparation will retry before submission"
            );
            repo.release(&claim).await?;
            return Err(error);
        }
        Err(PreparationError::Failed(error)) => {
            tracing::warn!(event = "email_send.preparation", outcome = "failed", error=?error,
                duration_ms = started.elapsed().as_millis() as u64, "email preparation needs attention");
            return repo.pause(&claim, DeliveryPause::Failed).await;
        }
    };
    tracing::Span::current().record("phase", "begin_submission");
    if !repo.begin_send(&claim).await? {
        tracing::info!(
            event = "email_send.claim_lost",
            "email delivery claim lost before submission"
        );
        return Ok(());
    }
    tracing::info!(
        event = "email_send.submission_started",
        "email provider submission boundary recorded"
    );
    tracing::Span::current().record("phase", "submit");
    let started = Instant::now();
    match sender.send_prepared(&claim, prepared).await {
        Ok(sent) => {
            tracing::info!(
                event = "email_send.provider_accepted",
                duration_ms = started.elapsed().as_millis() as u64,
                "provider accepted email; database completion pending"
            );
            tracing::Span::current().record("phase", "complete");
            repo.complete(&claim, sent).await
        }
        Err(SubmissionError::Rejected(error)) => {
            tracing::warn!(event = "email_send.submission", outcome = "rejected", error=?error,
                duration_ms = started.elapsed().as_millis() as u64, "email delivery was rejected");
            repo.pause(&claim, DeliveryPause::Failed).await
        }
        Err(SubmissionError::Uncertain(error)) => {
            tracing::warn!(event = "email_send.submission", outcome = "unconfirmed", error=?error,
                retry_delay_secs = RECONCILIATION_DELAY_SECONDS,
                duration_ms = started.elapsed().as_millis() as u64, "email delivery requires reconciliation");
            repo.pause(&claim, DeliveryPause::Unconfirmed).await
        }
    }
}

#[cfg(test)]
mod test;

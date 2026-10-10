//! Fenced delivery and recovery. An uncertain provider submission is reconciled,
//! never automatically repeated. No database lock spans provider work.

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
    let Some(ClaimedDelivery { claim, mode }) = repo.try_claim(link_id, message_id).await? else {
        return Ok(());
    };
    if mode == DeliveryMode::Reconcile {
        return match sender.reconcile(&claim).await {
            Ok(Some(sent)) => repo.complete(&claim, sent).await,
            Ok(None) => repo.pause(&claim, DeliveryPause::Unconfirmed).await,
            Err(error) => {
                repo.pause(&claim, DeliveryPause::Unconfirmed).await?;
                Err(error)
            }
        };
    }
    let prepared = match sender.prepare(&claim).await {
        Ok(prepared) => prepared,
        Err(PreparationError::Retry(error)) => {
            repo.release(&claim).await?;
            return Err(error);
        }
        Err(PreparationError::Failed(error)) => {
            tracing::warn!(error=?error, %message_id, "email preparation needs attention");
            return repo.pause(&claim, DeliveryPause::Failed).await;
        }
    };
    if !repo.begin_send(&claim).await? {
        return Ok(());
    }
    match sender.send_prepared(&claim, prepared).await {
        Ok(sent) => repo.complete(&claim, sent).await,
        Err(SubmissionError::Rejected(error)) => {
            tracing::warn!(error=?error, %message_id, "email delivery was rejected");
            repo.pause(&claim, DeliveryPause::Failed).await
        }
        Err(SubmissionError::Uncertain(error)) => {
            tracing::warn!(error=?error, %message_id, "email delivery requires reconciliation");
            repo.pause(&claim, DeliveryPause::Unconfirmed).await
        }
    }
}

#[cfg(test)]
mod test;

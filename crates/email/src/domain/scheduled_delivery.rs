//! Fenced delivery and recovery. An uncertain provider submission is reconciled
//! by looking it up, and repeated only after lookups spaced past the provider's
//! search delay keep finding no sent copy. No database lock spans provider work.

use std::time::Instant;
use uuid::Uuid;

/// Approved attachment identity checks shared by delivery adapters.
pub mod attachments;
/// Retained deletion resolution and message/thread cleanup sequencing.
#[cfg(feature = "mailbox")]
pub mod deletion;
/// Adoption of provider identities after a confirmed send.
#[cfg(feature = "mailbox")]
pub mod identity;
/// Recovery scanning and queue notification policy.
pub mod recovery;
/// Durable claim classification and fenced persistence decisions.
#[cfg(feature = "mailbox")]
pub mod state;

/// Scheduled delivery composed once with its persistence and provider capabilities.
pub struct ScheduledDeliveryService<A> {
    adapter: A,
}

impl<A> ScheduledDeliveryService<A> {
    /// Retain the already-constructed adapter for all deliveries.
    pub fn new(adapter: A) -> Self {
        Self { adapter }
    }
}

impl<A> ScheduledDeliveryService<A>
where
    A: ScheduledDeliveryRepo + ScheduledMessageSender<A::Claim, A::Sent>,
{
    /// Execute the existing fenced delivery workflow.
    pub async fn deliver(&self, link_id: Uuid, message_id: Uuid) -> anyhow::Result<()> {
        deliver_scheduled(&self.adapter, &self.adapter, link_id, message_id).await
    }
}

/// A worker must renew ownership before crossing the provider boundary.
pub const DELIVERY_LEASE_SECONDS: i32 = 300;
/// Failed lookups and negative searches may be retried without resending mail.
pub const RECONCILIATION_DELAY_SECONDS: i32 = 300;
/// Consecutive lookups that must find no sent copy before an uncertain send is
/// submitted again. The first runs a reconciliation delay after the
/// submission and the next another delay later, so a send is repeated only
/// after Gmail's search, which usually shows a sent message within seconds,
/// has missed it twice over ten minutes.
pub const ABSENT_LOOKUPS_BEFORE_RESEND: u16 = 2;
/// Automatic resends of one message. Bounds the copies a search that never
/// finds a sent message could cause.
pub const MAX_AUTOMATIC_RESENDS: u16 = 1;
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
    /// What earlier lookups found.
    pub lookups: LookupHistory,
}

/// What lookups found since the last submission, and earlier resends.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LookupHistory {
    /// Lookups that found no sent copy since the last submission.
    pub absent_lookups: u16,
    /// Submissions repeated after lookups found no sent copy.
    pub resends: u16,
}

/// What a lookup of an earlier submission found.
pub enum SentLookup<Sent> {
    /// The provider holds the sent message.
    Found(Sent),
    /// The provider was searched for the message's identity and holds no copy.
    Absent,
    /// The submission has no identity to search for, so nothing can be learned.
    Unsearchable,
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
    /// Count a lookup that found no sent copy and keep the outcome unconfirmed
    /// until the next lookup is due.
    fn record_absent_lookup(
        &self,
        claim: &Self::Claim,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Return the delivery to sending under the same Message-ID while this
    /// claim still owns it; whether it did.
    fn release_for_resend(
        &self,
        claim: &Self::Claim,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
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
    fn reconcile(
        &self,
        claim: &Claim,
    ) -> impl Future<Output = anyhow::Result<SentLookup<Sent>>> + Send;
}

/// Deliver or reconcile one queue item. No failure after the submission boundary
/// releases delivery authority for another automatic send; only lookups that
/// keep finding no sent copy do.
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
    let Some(ClaimedDelivery {
        claim,
        mode,
        lookups,
    }) = repo.try_claim(link_id, message_id).await?
    else {
        return Ok(());
    };
    tracing::Span::current().record("mode", tracing::field::debug(mode));
    if mode == DeliveryMode::Send {
        return send_claimed(repo, sender, claim).await;
    }
    if !reconcile_claimed(repo, sender, &claim, lookups).await? {
        return Ok(());
    }

    // The released delivery is claimed again for sending, as any worker would.
    tracing::Span::current().record("phase", "claim");
    match repo.try_claim(link_id, message_id).await? {
        Some(ClaimedDelivery {
            claim,
            mode: DeliveryMode::Send,
            ..
        }) => send_claimed(repo, sender, claim).await,
        _ => Ok(()),
    }
}

/// Look up an earlier submission. Whether the delivery was handed back to
/// sending because enough lookups found no sent copy.
async fn reconcile_claimed<R, S>(
    repo: &R,
    sender: &S,
    claim: &R::Claim,
    lookups: LookupHistory,
) -> anyhow::Result<bool>
where
    R: ScheduledDeliveryRepo,
    S: ScheduledMessageSender<R::Claim, R::Sent>,
{
    tracing::Span::current().record("phase", "reconcile");
    let started = Instant::now();
    match sender.reconcile(claim).await {
        Ok(SentLookup::Found(sent)) => {
            tracing::info!(
                event = "email_send.reconciliation",
                outcome = "found",
                duration_ms = started.elapsed().as_millis() as u64,
                "prior provider submission found"
            );
            tracing::Span::current().record("phase", "complete");
            repo.complete(claim, sent).await?;
            Ok(false)
        }
        Ok(SentLookup::Absent) => {
            let absent_lookups = lookups.absent_lookups + 1;
            let resend = absent_lookups >= ABSENT_LOOKUPS_BEFORE_RESEND
                && lookups.resends < MAX_AUTOMATIC_RESENDS;
            tracing::info!(
                event = "email_send.reconciliation",
                outcome = "not_found",
                absent_lookups,
                resend,
                retry_delay_secs = RECONCILIATION_DELAY_SECONDS,
                duration_ms = started.elapsed().as_millis() as u64,
                "no sent copy found"
            );
            if resend {
                tracing::Span::current().record("phase", "release_for_resend");
                return repo.release_for_resend(claim).await;
            }
            tracing::Span::current().record("phase", "pause");
            repo.record_absent_lookup(claim).await?;
            Ok(false)
        }
        Ok(SentLookup::Unsearchable) => {
            tracing::info!(
                event = "email_send.reconciliation",
                outcome = "unsearchable",
                duration_ms = started.elapsed().as_millis() as u64,
                "delivery has no identity to look up; it remains unconfirmed"
            );
            tracing::Span::current().record("phase", "pause");
            repo.pause(claim, DeliveryPause::Unconfirmed).await?;
            Ok(false)
        }
        Err(error) => {
            tracing::warn!(
                event = "email_send.reconciliation",
                outcome = "error",
                retry_delay_secs = RECONCILIATION_DELAY_SECONDS,
                duration_ms = started.elapsed().as_millis() as u64,
                "provider lookup failed; delivery remains unconfirmed"
            );
            repo.pause(claim, DeliveryPause::Unconfirmed).await?;
            Err(error)
        }
    }
}

/// Prepare and submit a delivery claimed for sending.
async fn send_claimed<R, S>(repo: &R, sender: &S, claim: R::Claim) -> anyhow::Result<()>
where
    R: ScheduledDeliveryRepo,
    S: ScheduledMessageSender<R::Claim, R::Sent>,
{
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

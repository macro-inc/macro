//! Claim ownership for queue-driven email delivery. No database lock spans the
//! provider call; only the invocation receiving a claim can release/finalize it.

use uuid::Uuid;

/// Atomic claim and completion persistence.
pub trait ScheduledDeliveryRepo: Sync {
    /// Proof that this invocation won the claim, including provider context.
    type Claim: Send + Sync;
    /// Provider result consumed by completion persistence.
    type Sent: Send;

    /// Claim a due, unsent, unclaimed message, committing before returning.
    fn try_claim(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<Self::Claim>>> + Send;
    /// Persist successful delivery and its post-commit side effects.
    fn complete(
        &self,
        claim: &Self::Claim,
        sent: Self::Sent,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Release only this invocation's failed claim.
    fn release(&self, claim: Self::Claim) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Provider delivery, deliberately outside any persistence transaction.
pub trait ScheduledMessageSender<Claim, Sent>: Sync {
    /// Load the committed payload/attachments and send it through the provider.
    fn send_claimed(&self, claim: &Claim) -> impl Future<Output = anyhow::Result<Sent>> + Send;
}

/// Deliver one queue item. Duplicate/stale items never release another worker's
/// claim. Provider ambiguity/reconciliation retains the existing retry policy.
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
    let Some(claim) = repo.try_claim(link_id, message_id).await? else {
        return Ok(());
    };
    let result = async {
        let sent = sender.send_claimed(&claim).await?;
        repo.complete(&claim, sent).await
    }
    .await;
    if result.is_err() {
        let _ = repo.release(claim).await.inspect_err(|error| {
            tracing::error!(error=?error, %message_id, %link_id, "failed to release owned delivery claim");
        });
    }
    result
}

#[cfg(test)]
mod test;

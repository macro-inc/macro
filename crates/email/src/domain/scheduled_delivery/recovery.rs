//! Recover due delivery work through durable queue notifications.

use futures::{Stream, TryStreamExt};
use uuid::Uuid;

/// A due message that may be claimed for delivery or reconciliation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingDelivery {
    /// Linked mailbox owning the message.
    pub link_id: Uuid,
    /// Local message requiring delivery work.
    pub message_id: Uuid,
}

/// Finds unsent, due work whose preparation/reconciliation backoff has elapsed.
pub trait ScheduledRecoveryRepo: Sync {
    /// Exclude permanent failures, active leases, future sends and sent messages.
    /// Expired leases are eligible even if a previous worker left processing set.
    fn pending_deliveries(&self) -> impl Stream<Item = anyhow::Result<PendingDelivery>> + Send;
}

/// Publishes a durable wakeup; the delivery claimant decides whether to send or reconcile.
pub trait ScheduledRecoveryQueue: Sync {
    /// Enqueue one eligible delivery without claiming or submitting it.
    fn enqueue(&self, delivery: PendingDelivery)
    -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Scans independently recoverable work so one queue failure cannot starve the rest.
#[derive(Clone)]
pub struct ScheduledRecovery<R, Q> {
    repo: R,
    queue: Q,
}

impl<R: ScheduledRecoveryRepo, Q: ScheduledRecoveryQueue> ScheduledRecovery<R, Q> {
    /// Compose recovery with persistence and notification ports.
    pub fn new(repo: R, queue: Q) -> Self {
        Self { repo, queue }
    }

    /// Republish due work. Failed queue writes stay due for the next scan.
    #[tracing::instrument(skip(self), err)]
    pub async fn scan(&self) -> anyhow::Result<()> {
        let pending = self.repo.pending_deliveries();
        futures::pin_mut!(pending);
        while let Some(delivery) = pending.try_next().await? {
            let _ = self.queue.enqueue(delivery).await.inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    link_id = %delivery.link_id,
                    message_id = %delivery.message_id,
                    "failed to enqueue scheduled email recovery",
                );
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;

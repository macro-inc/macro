//! Durable publication and recovery policy, independent of the queue transport.

use std::future::Future;

use super::{importer::reconcile_search, models::*, ports::*};

#[cfg(test)]
mod test;

const PAGE_SIZE: u32 = 50;

/// Recovery use cases remain available when new claims/publication are disabled.
pub trait Maintenance: Send + Sync {
    /// Publish a bounded outbox page, acknowledging only positively accepted sends.
    fn publish(&self) -> impl Future<Output = PortResult<()>> + Send;
    /// Recover expired work and reconcile partial-history search receipts.
    fn reconcile(&self) -> impl Future<Output = PortResult<()>> + Send;
    /// Persist exhausted work before allowing deletion; defer while a fence is active.
    fn dead_letter(
        &self,
        event: &ImportEvent,
    ) -> impl Future<Output = PortResult<WorkerOutcome>> + Send;
}

/// Domain service for outbox delivery, cancellation settlement and search recovery.
pub struct ImportMaintenance<R, Q, S, C, F> {
    repo: R,
    queue: Q,
    search: S,
    clock: C,
    references: F,
}

impl<R, Q, S, C, F> ImportMaintenance<R, Q, S, C, F> {
    /// Compose only domain capabilities; configuration is supplied by the application.
    pub fn new(repo: R, queue: Q, search: S, clock: C, references: F) -> Self {
        Self {
            repo,
            queue,
            search,
            clock,
            references,
        }
    }
}

impl<R: ExecutionRepo, Q: ImportQueue, S: SearchBackfillClient, C: Clock, F: ReferenceReconciler>
    Maintenance for ImportMaintenance<R, Q, S, C, F>
{
    async fn publish(&self) -> PortResult<()> {
        let mut failure = None;
        for event in self.repo.pending_events(PAGE_SIZE).await? {
            let result = async {
                self.queue.publish(&event).await?;
                self.repo.mark_published(&event).await
            }
            .await;
            if let Err(error) = result {
                // Never log the report: provider diagnostics can contain object keys/content.
                tracing::warn!(code = ?error.current_context(), operation = "outbox", "slack import retry");
                failure = Some(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    async fn reconcile(&self) -> PortResult<()> {
        self.repo.reconcile(PAGE_SIZE).await?;
        // Search recovery must continue even if one reference batch needs retry.
        let mut failure = self.references.reconcile_references(PAGE_SIZE).await.err();
        for request in self.repo.pending_search(PAGE_SIZE).await? {
            if let Err(error) =
                reconcile_search(&self.repo, &self.search, &self.clock, &request).await
            {
                tracing::warn!(code = ?error.current_context(), operation = "search", "slack import retry");
                failure = Some(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    async fn dead_letter(&self, event: &ImportEvent) -> PortResult<WorkerOutcome> {
        self.repo.dead_letter(event).await
    }
}

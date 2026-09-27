//! Internal permanent cleanup for owned description documents and failed creations.

use super::{
    events::{DocumentMacroEvent, DocumentPurgedMetadata},
    models::DocumentError,
};
use macro_event_broker::MacroEventBroker;
use model_owner::Owner;
use std::future::Future;

/// Owning document cleanup; callers must obtain the ID from their own lifecycle state.
pub trait DocumentPurgeService: Send + Sync + 'static {
    /// Permanently delete document metadata and schedule removal of stored content.
    fn purge(
        &self,
        document_id: uuid::Uuid,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// Permanent document persistence cleanup.
pub trait DocumentPurgeRepository: Send + Sync + 'static {
    /// Remove document metadata and return its owner captured before deletion.
    fn purge_rows(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<Owner, DocumentError>> + Send;
}

/// Existing background content-deletion queue.
pub trait DocumentPurgeQueue: Send + Sync + 'static {
    /// Schedule content cleanup using the owner retained after metadata deletion.
    fn enqueue(
        &self,
        document_id: String,
        owner: Owner,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// Shared lifecycle orchestration for permanent document cleanup.
pub struct DocumentPurger<R, Q, B> {
    repository: R,
    queue: Q,
    broker: B,
}

impl<R, Q, B> DocumentPurger<R, Q, B> {
    /// Compose persistence, cleanup delivery and the shared event broker.
    pub fn new(repository: R, queue: Q, broker: B) -> Self {
        Self {
            repository,
            queue,
            broker,
        }
    }
}

impl<R: DocumentPurgeRepository, Q: DocumentPurgeQueue, B: MacroEventBroker + 'static>
    DocumentPurgeService for DocumentPurger<R, Q, B>
{
    async fn purge(&self, document_id: uuid::Uuid) -> Result<(), DocumentError> {
        let document_id = document_id.to_string();
        let owner = self.repository.purge_rows(&document_id).await?;
        // Both follow-ups must run even if content cleanup delivery is temporarily unavailable.
        let cleanup = self.queue.enqueue(document_id.clone(), owner).await;
        let event =
            DocumentMacroEvent::purged(document_id.clone(), DocumentPurgedMetadata { document_id });
        let publication = match self.broker.send_event(&event) {
            Ok(delivery) => delivery
                .await
                .map_err(|error| DocumentError::Internal(error.into()))?
                .map_err(|error| DocumentError::Internal(error.into())),
            Err(error) => Err(DocumentError::Internal(error.into())),
        };
        cleanup.and(publication)
    }
}

#[cfg(test)]
mod test;

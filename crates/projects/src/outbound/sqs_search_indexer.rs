//! Kafka search-cleanup and SQS document-deletion adapter.

#[cfg(test)]
mod test;

use std::sync::Arc;

use documents::domain::events::{DocumentMacroEvent, DocumentPurgedMetadata};
use macro_event_broker::MacroEventBroker;

use crate::domain::ports::ProjectSearchIndexer;

/// Kafka-backed document search cleanup and SQS-backed document deletion adapter.
#[derive(Clone)]
pub struct SqsProjectSearchIndexer<B: MacroEventBroker> {
    sqs: Arc<sqs_client::SQS>,
    event_broker: B,
}

impl<B: MacroEventBroker> SqsProjectSearchIndexer<B> {
    /// Create a project search indexer from the shared SQS client and event broker.
    pub fn new(sqs: Arc<sqs_client::SQS>, event_broker: B) -> Self {
        Self { sqs, event_broker }
    }
}

impl<B: MacroEventBroker> ProjectSearchIndexer for SqsProjectSearchIndexer<B> {
    #[tracing::instrument(skip(self), err)]
    async fn remove_documents(&self, document_ids: Vec<String>) -> anyhow::Result<()> {
        for document_id in document_ids {
            let event = DocumentMacroEvent::purged(
                document_id.clone(),
                DocumentPurgedMetadata { document_id },
            );
            drop(self.event_broker.send_event(&event)?);
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn enqueue_document_deletes(
        &self,
        documents: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        self.sqs
            .bulk_enqueue_document_delete_with_owner(documents)
            .await
    }
}

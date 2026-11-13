//! Kafka search-cleanup and SQS document-deletion adapter.

#[cfg(test)]
mod test;

use std::sync::Arc;

use documents::domain::events::{DocumentMacroEvent, DocumentPurgedMetadata};
use futures::StreamExt;
use macro_event_broker::MacroEventBroker;

use crate::domain::ports::ProjectSearchIndexer;

/// The most messages SQS accepts in one `SendMessageBatch`.
const SQS_MAX_BATCH_SIZE: usize = 10;

/// Document delete batches in flight at once during a folder purge.
const CONCURRENT_DOCUMENT_DELETE_BATCHES: usize = 8;

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

    /// SQS takes at most ten messages per batch, so a 10,000-document folder
    /// needs 1,000 batches; sent one after another they kept a purge request
    /// open for most of a minute. Send a few at a time and try every batch,
    /// so one failed batch does not strand the documents after it.
    #[tracing::instrument(
        name = "project.purge.enqueue_document_deletes",
        skip_all,
        fields(
            document.count = documents.len(),
            batch.failed_count = tracing::field::Empty,
        ),
        err
    )]
    async fn enqueue_document_deletes(
        &self,
        documents: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        let batches = documents
            .chunks(SQS_MAX_BATCH_SIZE)
            .map(<[_]>::to_vec)
            .collect::<Vec<_>>();
        let failed = futures::stream::iter(batches)
            .map(|batch| self.sqs.bulk_enqueue_document_delete_with_owner(batch))
            .buffer_unordered(CONCURRENT_DOCUMENT_DELETE_BATCHES)
            .filter_map(|result| async move {
                result
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, "unable to enqueue a document delete batch");
                    })
                    .err()
            })
            .count()
            .await;
        tracing::Span::current().record("batch.failed_count", failed);

        if failed > 0 {
            anyhow::bail!("{failed} document delete batches failed to enqueue");
        }
        Ok(())
    }
}

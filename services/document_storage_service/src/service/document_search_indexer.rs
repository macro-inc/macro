//! Adapter that publishes document name refreshes to the search queue.

use documents_hex::domain::ports::DocumentSearchIndexer;
use sqs_client::SQS;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::document::DocumentId;

/// Publishes a refresh of a document's denormalized name to the shared search
/// event queue so the search-processing service updates the indexed
/// `document_name` after a rename.
#[derive(Debug)]
pub struct SqsDocumentSearchIndexer {
    sqs: SQS,
}

impl SqsDocumentSearchIndexer {
    pub fn new(sqs: SQS) -> Self {
        Self { sqs }
    }
}

impl DocumentSearchIndexer for SqsDocumentSearchIndexer {
    fn enqueue_name_update(
        &self,
        document_id: String,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send>> {
        let sqs = self.sqs.clone();
        Box::pin(async move {
            sqs.send_message_to_search_event_queue(SearchQueueMessage::UpdateDocumentName(
                DocumentId { document_id },
            ))
            .await?;
            Ok(())
        })
    }
}

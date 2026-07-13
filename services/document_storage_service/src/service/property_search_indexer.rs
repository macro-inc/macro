//! Adapter that publishes property search-index upserts to the search queue.

use models_properties::EntityType;
use properties::PropertySearchIndexer;
use sqs_client::SQS;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::document::DocumentPropertiesUpdate;

/// Publishes an upsert of an entity's indexed properties to the shared search
/// event queue so the search-processing service refreshes them after a write.
#[derive(Debug)]
pub struct SqsPropertySearchIndexer {
    sqs: SQS,
}

impl SqsPropertySearchIndexer {
    pub fn new(sqs: SQS) -> Self {
        Self { sqs }
    }
}

impl PropertySearchIndexer for SqsPropertySearchIndexer {
    fn enqueue_upsert(
        &self,
        entity_id: String,
        entity_type: EntityType,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send>> {
        let sqs = self.sqs.clone();
        Box::pin(async move {
            sqs.send_message_to_search_event_queue(SearchQueueMessage::UpdateDocumentProperties(
                DocumentPropertiesUpdate {
                    document_id: entity_id,
                    entity_type: entity_type.to_string(),
                },
            ))
            .await?;
            Ok(())
        })
    }
}

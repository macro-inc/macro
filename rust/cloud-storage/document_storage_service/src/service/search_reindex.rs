//! Adapter that publishes property-reindex events to the search event queue.

use models_properties::EntityType;
use properties::SearchReindexPort;
use sqs_client::SQS;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::document::DocumentPropertiesUpdate;

/// Publishes a reindex of an entity's properties so the search index refreshes
/// after a property mutation. Backed by the shared search event queue that the
/// search-processing service consumes.
#[derive(Debug)]
pub struct SqsPropertyReindex {
    sqs: SQS,
}

impl SqsPropertyReindex {
    pub fn new(sqs: SQS) -> Self {
        Self { sqs }
    }
}

impl SearchReindexPort for SqsPropertyReindex {
    fn enqueue_property_reindex(
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

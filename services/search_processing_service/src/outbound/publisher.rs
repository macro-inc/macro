use std::sync::Arc;

use sqs_client::search::SearchQueueMessage;

use crate::domain::models::BackfillError;
use crate::domain::ports::SearchEventPublisher;

/// SQS-backed implementation of [`SearchEventPublisher`]. The only adapter
/// in sps that talks to the search-event queue.
pub struct SqsSearchEventPublisher {
    sqs: Arc<sqs_client::SQS>,
}

impl SqsSearchEventPublisher {
    pub fn new(sqs: Arc<sqs_client::SQS>) -> Self {
        Self { sqs }
    }
}

impl SearchEventPublisher for SqsSearchEventPublisher {
    async fn publish(&self, messages: Vec<SearchQueueMessage>) -> Result<(), BackfillError> {
        if messages.is_empty() {
            return Ok(());
        }
        self.sqs
            .bulk_send_message_to_search_event_queue(messages)
            .await
            .map_err(BackfillError::Publish)
    }
}

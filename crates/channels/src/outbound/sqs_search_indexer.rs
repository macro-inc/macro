//! SQS search-index adapter for channel side effects.

use crate::domain::ports::ChannelSearchIndexer;
use std::sync::Arc;
use uuid::Uuid;

/// SQS-backed search index adapter.
#[derive(Clone)]
pub struct SqsChannelSearchIndexer {
    sqs: Arc<sqs_client::SQS>,
}

impl SqsChannelSearchIndexer {
    /// Create a search index adapter.
    pub fn new(sqs: Arc<sqs_client::SQS>) -> Self {
        Self { sqs }
    }
}

impl ChannelSearchIndexer for SqsChannelSearchIndexer {
    async fn index_message(&self, channel_id: Uuid, message_id: Uuid) {
        let sqs = self.sqs.clone();
        tokio::spawn(async move {
            sqs.send_message_to_search_event_queue(
                sqs_client::search::SearchQueueMessage::ChannelMessageUpdate(
                    sqs_client::search::channel::ChannelMessageUpdate {
                        channel_id: channel_id.to_string(),
                        message_id: message_id.to_string(),
                        index_override: None,
                    },
                ),
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
            })
            .ok();
        });
    }

    async fn remove_message(&self, channel_id: Uuid, message_id: Option<Uuid>) {
        let sqs = self.sqs.clone();
        tokio::spawn(async move {
            sqs.send_message_to_search_event_queue(
                sqs_client::search::SearchQueueMessage::RemoveChannelMessage(
                    sqs_client::search::channel::RemoveChannelMessage {
                        channel_id: channel_id.to_string(),
                        message_id: message_id.map(|id| id.to_string()),
                        index_override: None,
                    },
                ),
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue remove message");
            })
            .ok();
        });
    }
}

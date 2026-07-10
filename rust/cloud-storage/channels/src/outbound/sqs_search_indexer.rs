//! Queue-backed search-index adapter for channel side effects.

use crate::domain::ports::{ChannelSearchIndexer, ChannelSearchQueue};
use std::sync::Arc;
use uuid::Uuid;

/// Queue-backed search index adapter.
#[derive(Clone)]
pub struct SqsChannelSearchIndexer {
    queue: Arc<dyn ChannelSearchQueue>,
}

impl SqsChannelSearchIndexer {
    /// Create a search index adapter.
    pub fn new<Q>(queue: Arc<Q>) -> Self
    where
        Q: ChannelSearchQueue,
    {
        Self { queue }
    }
}

impl ChannelSearchIndexer for SqsChannelSearchIndexer {
    async fn index_message(&self, channel_id: Uuid, message_id: Uuid) {
        let queue = self.queue.clone();
        tokio::spawn(async move {
            queue
                .enqueue_message(channel_id, message_id)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                })
                .ok();
        });
    }

    async fn remove_message(&self, channel_id: Uuid, message_id: Option<Uuid>) {
        let queue = self.queue.clone();
        tokio::spawn(async move {
            queue
                .enqueue_removal(channel_id, message_id)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue remove message");
                })
                .ok();
        });
    }
}

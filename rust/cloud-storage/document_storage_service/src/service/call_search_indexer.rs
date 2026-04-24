use std::sync::Arc;

use call::domain::ports::CallSearchIndexer;
use sqs_client::{
    SQS,
    search::{
        SearchQueueMessage,
        call::{CallRecordMessage, RemoveCallRecord},
    },
};
use uuid::Uuid;

#[derive(Clone)]
pub struct SqsCallSearchIndexer {
    sqs: Arc<SQS>,
}

impl SqsCallSearchIndexer {
    pub fn new(sqs: Arc<SQS>) -> Self {
        Self { sqs }
    }
}

impl CallSearchIndexer for SqsCallSearchIndexer {
    async fn enqueue_upsert(&self, call_id: &Uuid) -> anyhow::Result<()> {
        self.sqs
            .send_message_to_search_event_queue(SearchQueueMessage::CallRecord(CallRecordMessage {
                call_id: call_id.to_string(),
            }))
            .await?;
        Ok(())
    }

    async fn enqueue_remove(&self, channel_id: &Uuid, call_id: &Uuid) -> anyhow::Result<()> {
        self.sqs
            .send_message_to_search_event_queue(SearchQueueMessage::RemoveCallRecord(
                RemoveCallRecord {
                    channel_id: channel_id.to_string(),
                    call_id: Some(call_id.to_string()),
                },
            ))
            .await?;
        Ok(())
    }
}

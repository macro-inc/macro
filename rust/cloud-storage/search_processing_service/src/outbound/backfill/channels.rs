use std::sync::Arc;

use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, channel::ChannelMessageUpdate};

use crate::domain::models::{BackfillError, BackfillReceipt, ChannelBackfillRequest};
use crate::domain::ports::ChannelBackfill;

const PAGE: i64 = 5000;

/// Postgres-backed [`ChannelBackfill`] adapter against macrodb.
pub struct PgChannelBackfill {
    db: PgPool,
    sqs: Arc<sqs_client::SQS>,
}

impl PgChannelBackfill {
    pub fn new(db: PgPool, sqs: Arc<sqs_client::SQS>) -> Self {
        Self { db, sqs }
    }
}

impl ChannelBackfill for PgChannelBackfill {
    async fn enqueue(
        &self,
        _req: ChannelBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        let mut offset = 0i64;
        let mut enqueued = 0usize;

        loop {
            let batch = comms_db_client::messages::get_messages::get_channel_messages(
                &self.db, PAGE, offset,
            )
            .await
            .map_err(BackfillError::Source)?;

            if batch.is_empty() {
                break;
            }

            let batch_len = batch.len();
            let messages: Vec<SearchQueueMessage> = batch
                .into_iter()
                .map(|(channel_id, message_id)| {
                    SearchQueueMessage::ChannelMessageUpdate(ChannelMessageUpdate {
                        channel_id: channel_id.to_string(),
                        message_id: message_id.to_string(),
                    })
                })
                .collect();

            enqueued += messages.len();
            self.sqs
                .bulk_send_message_to_search_event_queue(messages)
                .await
                .map_err(BackfillError::Publish)?;

            if (batch_len as i64) < PAGE {
                break;
            }
            offset += PAGE;
        }

        Ok(BackfillReceipt { enqueued })
    }
}

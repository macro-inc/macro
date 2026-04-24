use std::sync::Arc;

use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, chat::ChatMessage};

use crate::domain::models::{BackfillError, BackfillReceipt, ChatBackfillRequest};
use crate::domain::ports::ChatBackfill;

const PAGE: i64 = 5000;

/// Postgres-backed [`ChatBackfill`] adapter against macrodb.
pub struct PgChatBackfill {
    db: PgPool,
    sqs: Arc<sqs_client::SQS>,
}

impl PgChatBackfill {
    pub fn new(db: PgPool, sqs: Arc<sqs_client::SQS>) -> Self {
        Self { db, sqs }
    }
}

impl ChatBackfill for PgChatBackfill {
    async fn enqueue(&self, req: ChatBackfillRequest) -> Result<BackfillReceipt, BackfillError> {
        let chat_ids = (!req.chat_ids.is_empty()).then_some(req.chat_ids);
        let user_ids = (!req.user_ids.is_empty()).then_some(req.user_ids);

        let mut offset = 0i64;
        let mut enqueued = 0usize;

        loop {
            let batch = macro_db_client::chat::get::get_chat_messages_for_search_backfill(
                &self.db,
                PAGE,
                offset,
                chat_ids.as_ref(),
                user_ids.as_ref(),
            )
            .await
            .map_err(BackfillError::Source)?;

            if batch.is_empty() {
                break;
            }

            let batch_len = batch.len();
            let messages: Vec<SearchQueueMessage> = batch
                .into_iter()
                .map(|chat| {
                    SearchQueueMessage::ChatMessage(ChatMessage {
                        chat_id: chat.chat_id,
                        message_id: chat.message_id,
                        user_id: chat.user_id,
                        created_at: chat.created_at,
                        updated_at: chat.updated_at,
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

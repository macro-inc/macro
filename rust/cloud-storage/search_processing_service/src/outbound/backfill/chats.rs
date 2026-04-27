use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, chat::ChatMessage};

use crate::domain::models::{BackfillError, ChatBackfillRequest};
use crate::domain::ports::ChatBackfillSource;

/// Postgres-backed [`ChatBackfillSource`] against macrodb.
pub struct PgChatSource {
    db: PgPool,
    page_size: usize,
}

impl PgChatSource {
    pub fn new(db: PgPool, page_size: usize) -> Self {
        Self { db, page_size }
    }
}

impl ChatBackfillSource for PgChatSource {
    async fn fetch_page(
        &self,
        req: &ChatBackfillRequest,
        offset: usize,
    ) -> Result<Vec<SearchQueueMessage>, BackfillError> {
        let chat_ids = (!req.chat_ids.is_empty()).then(|| req.chat_ids.clone());
        let user_ids = (!req.user_ids.is_empty()).then(|| req.user_ids.clone());

        let batch = macro_db_client::chat::get::get_chat_messages_for_search_backfill(
            &self.db,
            self.page_size as i64,
            offset as i64,
            chat_ids.as_ref(),
            user_ids.as_ref(),
        )
        .await
        .map_err(BackfillError::Source)?;

        Ok(batch
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
            .collect())
    }
}

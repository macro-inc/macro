use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, channel::ChannelMessageUpdate};

use crate::domain::models::{BackfillError, ChannelBackfillRequest, SourcePage};
use crate::domain::ports::ChannelBackfillSource;

/// Postgres-backed [`ChannelBackfillSource`] against macrodb.
pub struct PgChannelSource {
    db: PgPool,
    page_size: usize,
}

impl PgChannelSource {
    pub fn new(db: PgPool, page_size: usize) -> Self {
        Self { db, page_size }
    }
}

impl ChannelBackfillSource for PgChannelSource {
    async fn fetch_page(
        &self,
        _req: &ChannelBackfillRequest,
        offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        let batch = comms_db_client::messages::get_messages::get_channel_messages(
            &self.db,
            self.page_size as i64,
            offset as i64,
        )
        .await
        .map_err(BackfillError::Source)?;

        let rows_consumed = batch.len();
        let messages: Vec<SearchQueueMessage> = batch
            .into_iter()
            .map(|(channel_id, message_id)| {
                SearchQueueMessage::ChannelMessageUpdate(ChannelMessageUpdate {
                    channel_id: channel_id.to_string(),
                    message_id: message_id.to_string(),
                })
            })
            .collect();

        Ok(SourcePage {
            messages,
            rows_consumed,
        })
    }
}

use std::sync::Arc;

use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, call::CallRecordMessage};

use crate::domain::models::{BackfillError, BackfillReceipt, CallBackfillRequest};
use crate::domain::ports::CallBackfill;

const PAGE: i64 = 2000;

/// Postgres-backed [`CallBackfill`] adapter: reads archived call ids out of
/// macrodb and enqueues one `CallRecord` message per call for sps's own
/// workers to process.
pub struct PgCallBackfill {
    db: PgPool,
    sqs: Arc<sqs_client::SQS>,
}

impl PgCallBackfill {
    pub fn new(db: PgPool, sqs: Arc<sqs_client::SQS>) -> Self {
        Self { db, sqs }
    }
}

impl CallBackfill for PgCallBackfill {
    async fn enqueue(&self, req: CallBackfillRequest) -> Result<BackfillReceipt, BackfillError> {
        if !req.call_ids.is_empty() {
            let messages: Vec<SearchQueueMessage> = req
                .call_ids
                .into_iter()
                .map(|call_id| SearchQueueMessage::CallRecord(CallRecordMessage { call_id }))
                .collect();
            let count = messages.len();
            self.sqs
                .bulk_send_message_to_search_event_queue(messages)
                .await
                .map_err(BackfillError::Publish)?;
            return Ok(BackfillReceipt { enqueued: count });
        }

        let mut offset = 0i64;
        let mut enqueued = 0usize;

        loop {
            let batch = macro_db_client::call_record::get::get_call_records_for_search_backfill(
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
                .map(|r| {
                    SearchQueueMessage::CallRecord(CallRecordMessage {
                        call_id: r.call_id.to_string(),
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

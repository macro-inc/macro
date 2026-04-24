use std::sync::Arc;

use model::document::FileType;
use sqlx::PgPool;
use sqs_client::search::SearchQueueMessage;

use crate::domain::models::{BackfillError, BackfillReceipt, DocumentBackfillRequest};
use crate::domain::ports::DocumentBackfill;

const PAGE: i64 = 1000;

/// Postgres-backed [`DocumentBackfill`] adapter against macrodb.
pub struct PgDocumentBackfill {
    db: PgPool,
    sqs: Arc<sqs_client::SQS>,
}

impl PgDocumentBackfill {
    pub fn new(db: PgPool, sqs: Arc<sqs_client::SQS>) -> Self {
        Self { db, sqs }
    }
}

impl DocumentBackfill for PgDocumentBackfill {
    async fn enqueue(
        &self,
        req: DocumentBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        let mut offset = 0i64;
        let mut enqueued = 0usize;

        loop {
            let batch = macro_db_client::document::get_documents_search::get_documents_for_search(
                &self.db,
                PAGE,
                offset,
                &req.file_types,
                &req.sub_type,
                &req.created_after,
                &req.created_before,
            )
            .await
            .map_err(BackfillError::Source)?;

            if batch.is_empty() {
                break;
            }

            let batch_len = batch.len();
            let messages: Vec<SearchQueueMessage> = batch
                .iter()
                .map(|d| {
                    if d.file_type == FileType::Md {
                        SearchQueueMessage::ExtractSync(d.into())
                    } else {
                        SearchQueueMessage::ExtractDocumentText(d.into())
                    }
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

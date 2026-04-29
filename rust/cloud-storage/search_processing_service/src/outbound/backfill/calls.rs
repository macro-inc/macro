use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, call::CallRecordMessage};

use crate::domain::models::{BackfillError, CallBackfillRequest, SourcePage};
use crate::domain::ports::CallBackfillSource;

/// Postgres-backed [`CallBackfillSource`] reading archived calls out of
/// macrodb. Pure read: no queue knowledge.
pub struct PgCallSource {
    db: PgPool,
    page_size: usize,
}

impl PgCallSource {
    pub fn new(db: PgPool, page_size: usize) -> Self {
        Self { db, page_size }
    }
}

impl CallBackfillSource for PgCallSource {
    async fn fetch_page(
        &self,
        req: &CallBackfillRequest,
        offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        // Caller passed an explicit set of ids: page through them at the
        // adapter's configured page size so the explicit-ids branch and the
        // full-scan branch share the same loop shape and failure semantics.
        if !req.call_ids.is_empty() {
            let start = offset;
            if start >= req.call_ids.len() {
                return Ok(SourcePage::empty());
            }
            let end = (start + self.page_size).min(req.call_ids.len());
            let messages: Vec<SearchQueueMessage> = req.call_ids[start..end]
                .iter()
                .map(|id| {
                    SearchQueueMessage::CallRecord(CallRecordMessage {
                        call_id: id.clone(),
                    })
                })
                .collect();
            return Ok(SourcePage {
                messages,
                rows_consumed: end - start,
            });
        }

        let batch = macro_db_client::call_record::get::get_call_records_for_search_backfill(
            &self.db,
            self.page_size as i64,
            offset as i64,
        )
        .await
        .map_err(BackfillError::Source)?;

        let rows_consumed = batch.len();
        let messages: Vec<SearchQueueMessage> = batch
            .into_iter()
            .map(|r| {
                SearchQueueMessage::CallRecord(CallRecordMessage {
                    call_id: r.call_id.to_string(),
                })
            })
            .collect();

        Ok(SourcePage {
            messages,
            rows_consumed,
        })
    }
}

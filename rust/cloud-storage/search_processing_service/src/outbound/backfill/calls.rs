use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, call::CallRecordMessage};

use crate::domain::models::{BackfillError, CallBackfillRequest};
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
    ) -> Result<Vec<SearchQueueMessage>, BackfillError> {
        // Caller passed an explicit set of ids: emit them all on the first
        // page; subsequent pages are empty so the orchestrator's loop stops.
        if !req.call_ids.is_empty() {
            if offset > 0 {
                return Ok(vec![]);
            }
            return Ok(req
                .call_ids
                .iter()
                .map(|id| {
                    SearchQueueMessage::CallRecord(CallRecordMessage {
                        call_id: id.clone(),
                    })
                })
                .collect());
        }

        let batch = macro_db_client::call_record::get::get_call_records_for_search_backfill(
            &self.db,
            self.page_size as i64,
            offset as i64,
        )
        .await
        .map_err(BackfillError::Source)?;

        Ok(batch
            .into_iter()
            .map(|r| {
                SearchQueueMessage::CallRecord(CallRecordMessage {
                    call_id: r.call_id.to_string(),
                })
            })
            .collect())
    }
}

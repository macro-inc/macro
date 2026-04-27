use std::collections::HashMap;

use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, email::EmailThreadBatchMessage};

use crate::domain::models::{BackfillError, EmailBackfillRequest, SourcePage};
use crate::domain::ports::EmailBackfillSource;

const DEFAULT_BATCH_SIZE: usize = 50;

/// Postgres-backed [`EmailBackfillSource`] against macrodb. The number of
/// SQS messages produced is much smaller than the row count because we
/// chunk a user's thread ids into per-user batches before publishing — the
/// orchestrator advances its DB offset by [`SourcePage::rows_consumed`]
/// (the row count), not by message count, so this batching is safe.
pub struct PgEmailSource {
    db: PgPool,
    page_size: usize,
}

impl PgEmailSource {
    pub fn new(db: PgPool, page_size: usize) -> Self {
        Self { db, page_size }
    }
}

impl EmailBackfillSource for PgEmailSource {
    async fn fetch_page(
        &self,
        req: &EmailBackfillRequest,
        offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        let batch_size = req
            .batch_size
            .filter(|n| *n > 0)
            .unwrap_or(DEFAULT_BATCH_SIZE);

        let rows = match req.since {
            Some(since) => {
                email_db_client::threads::get::get_paginated_thread_ids_with_macro_user_id_since(
                    &self.db,
                    self.page_size as i64,
                    offset as i64,
                    since,
                )
                .await
                .map_err(BackfillError::Source)?
            }
            None => email_db_client::threads::get::get_paginated_thread_ids_with_macro_user_id(
                &self.db,
                self.page_size as i64,
                offset as i64,
            )
            .await
            .map_err(BackfillError::Source)?,
        };

        let rows_consumed = rows.len();
        if rows_consumed == 0 {
            return Ok(SourcePage::empty());
        }

        let mut by_user: HashMap<String, Vec<String>> = HashMap::new();
        for (thread_id, macro_user_id) in rows {
            by_user
                .entry(macro_user_id)
                .or_default()
                .push(thread_id.to_string());
        }

        let messages: Vec<SearchQueueMessage> = by_user
            .into_iter()
            .flat_map(|(macro_user_id, thread_ids)| {
                thread_ids
                    .chunks(batch_size)
                    .map(|chunk| {
                        SearchQueueMessage::ExtractEmailThreadBatch(EmailThreadBatchMessage {
                            thread_ids: chunk.to_vec(),
                            macro_user_id: macro_user_id.clone(),
                            index_override: req.index_override.clone(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .collect();

        Ok(SourcePage {
            messages,
            rows_consumed,
        })
    }
}

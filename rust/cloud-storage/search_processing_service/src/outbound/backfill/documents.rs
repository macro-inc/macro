use model::document::FileType;
use sqlx::PgPool;
use sqs_client::search::SearchQueueMessage;

use crate::domain::models::{BackfillError, DocumentBackfillRequest};
use crate::domain::ports::DocumentBackfillSource;

/// Postgres-backed [`DocumentBackfillSource`] against macrodb.
pub struct PgDocumentSource {
    db: PgPool,
    page_size: usize,
}

impl PgDocumentSource {
    pub fn new(db: PgPool, page_size: usize) -> Self {
        Self { db, page_size }
    }
}

impl DocumentBackfillSource for PgDocumentSource {
    async fn fetch_page(
        &self,
        req: &DocumentBackfillRequest,
        offset: usize,
    ) -> Result<Vec<SearchQueueMessage>, BackfillError> {
        let batch = macro_db_client::document::get_documents_search::get_documents_for_search(
            &self.db,
            self.page_size as i64,
            offset as i64,
            &req.file_types,
            &req.sub_type,
            &req.created_after,
            &req.created_before,
        )
        .await
        .map_err(BackfillError::Source)?;

        Ok(batch
            .iter()
            .map(|d| {
                if d.file_type == FileType::Md {
                    SearchQueueMessage::ExtractSync(d.into())
                } else {
                    SearchQueueMessage::ExtractDocumentText(d.into())
                }
            })
            .collect())
    }
}

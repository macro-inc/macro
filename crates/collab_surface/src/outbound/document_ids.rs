//! The document id namespace, which surfaces share in sync-service, read
//! through macro_db_client's helper for the documents table.

use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::ports::DocumentIds;

/// [`DocumentIds`] over macro_db_client's `does_document_exist`.
#[derive(Debug, Clone)]
pub struct PgDocumentIds {
    pool: PgPool,
}

impl PgDocumentIds {
    /// Read document ids from the shared Postgres pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl DocumentIds for PgDocumentIds {
    #[tracing::instrument(err, skip(self))]
    async fn is_document_id(&self, id: Uuid) -> Result<bool, rootcause::Report> {
        // Document ids are canonical lowercase text, and the sync-service
        // session key is that exact spelling. Soft-deleted documents keep their
        // session, so the helper deliberately counts them.
        macro_db_client::dcs::does_document_exist::does_document_exist(
            self.pool.clone(),
            &id.to_string(),
        )
        .await
        .map_err(|e| rootcause::report!("failed to look up document id {id}: {e:?}").into_dynamic())
    }
}

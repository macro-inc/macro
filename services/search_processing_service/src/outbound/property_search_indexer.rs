use std::sync::Arc;

use models_properties::EntityType;
use opensearch_client::OpensearchClient;
use rootcause::compat::anyhow1::IntoAnyhow as _;
use sqlx::PgPool;

use crate::EmailIndexer;
use crate::domain::email_index::LeasePool;
use crate::domain::models::BackfillError;
use crate::domain::ports::PropertyBackfillIndexer;
use crate::process::properties::{PropertyRefreshError, process_entity_property_update};

/// Direct property backfill adapter backed by the primary database and
/// OpenSearch. Email threads are rewritten through the fenced email indexer on
/// the bulk lock connections.
pub struct DirectPropertyBackfillIndexer {
    db: PgPool,
    opensearch_client: Arc<OpensearchClient>,
    email_indexer: Arc<EmailIndexer>,
}

impl DirectPropertyBackfillIndexer {
    pub fn new(
        db: PgPool,
        opensearch_client: Arc<OpensearchClient>,
        email_indexer: Arc<EmailIndexer>,
    ) -> Self {
        Self {
            db,
            opensearch_client,
            email_indexer,
        }
    }
}

impl PropertyBackfillIndexer for DirectPropertyBackfillIndexer {
    async fn reindex(&self, entity_id: &str, entity_type: EntityType) -> Result<(), BackfillError> {
        process_entity_property_update(
            &self.opensearch_client,
            &self.email_indexer,
            &self.db,
            entity_id,
            entity_type,
            LeasePool::Bulk,
        )
        .await
        .map(|_refresh| ())
        .map_err(|error| {
            BackfillError::Reindex(match error {
                PropertyRefreshError::EmailThread(report) => report.into_anyhow(),
                PropertyRefreshError::Other(error) => error,
            })
        })
    }
}

use std::sync::Arc;

use models_properties::EntityType;
use opensearch_client::OpensearchClient;
use sqlx::PgPool;

use crate::domain::models::BackfillError;
use crate::domain::ports::PropertyBackfillIndexer;
use crate::process::properties::process_entity_property_update;

/// Direct property backfill adapter backed by the primary database and
/// OpenSearch.
pub struct DirectPropertyBackfillIndexer {
    db: PgPool,
    opensearch_client: Arc<OpensearchClient>,
}

impl DirectPropertyBackfillIndexer {
    pub fn new(db: PgPool, opensearch_client: Arc<OpensearchClient>) -> Self {
        Self {
            db,
            opensearch_client,
        }
    }
}

impl PropertyBackfillIndexer for DirectPropertyBackfillIndexer {
    async fn reindex(&self, entity_id: &str, entity_type: EntityType) -> Result<(), BackfillError> {
        process_entity_property_update(&self.opensearch_client, &self.db, entity_id, entity_type)
            .await
            .map_err(BackfillError::Reindex)
    }
}

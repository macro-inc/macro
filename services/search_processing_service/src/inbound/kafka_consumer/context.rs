use std::sync::Arc;

use lexical_client::LexicalClient;
use opensearch_client::OpensearchClient;
use s3_client::S3;
use sqlx::PgPool;

/// Shared dependencies used to process search-index events from Kafka.
#[derive(Clone)]
pub(crate) struct KafkaProcessingContext {
    pub(crate) db: PgPool,
    pub(crate) opensearch_client: Arc<OpensearchClient>,
    pub(crate) s3_client: Arc<S3>,
    pub(crate) document_storage_bucket: String,
    pub(crate) lexical_client: Arc<LexicalClient>,
    /// Whether calendar events are written to the search index.
    pub(crate) calendar_search_enabled: bool,
}

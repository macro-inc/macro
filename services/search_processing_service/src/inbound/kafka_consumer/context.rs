use std::sync::Arc;

use lexical_client::LexicalClient;
use opensearch_client::OpensearchClient;
use s3_client::S3;
use sqlx::PgPool;

use crate::process::email::mailbox_delete::MailboxDeletes;

use super::IndexMetrics;

/// Shared dependencies used to process search-index events from Kafka.
#[derive(Clone)]
pub(crate) struct KafkaProcessingContext {
    pub(crate) agent_session_indexer: Arc<crate::AgentSessionIndexer>,
    pub(crate) database_row_indexer: Arc<crate::DatabaseRowIndexer>,
    pub(crate) db: PgPool,
    pub(crate) opensearch_client: Arc<OpensearchClient>,
    pub(crate) s3_client: Arc<S3>,
    pub(crate) document_storage_bucket: String,
    pub(crate) lexical_client: Arc<LexicalClient>,
    /// Whether calendar events are written to the search index.
    pub(crate) calendar_search_enabled: bool,
    /// Whole-inbox index deletes, run off the consumer's workers.
    pub(crate) mailbox_deletes: MailboxDeletes,
    pub(crate) metrics: IndexMetrics,
    /// Where events whose attempts failed wait for their replay.
    pub(crate) replays: Arc<sqs_client::SQS>,
}

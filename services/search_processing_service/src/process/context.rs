use std::sync::Arc;

#[derive(Clone)]
pub struct SearchProcessingContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub worker: Arc<sqs_worker::SQSWorker>,
    pub document_storage_bucket: String,
    pub s3_client: Arc<s3_client::S3>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub lexical_client: Arc<lexical_client::LexicalClient>,
    /// Whether calendar events are written to the search index.
    pub calendar_search_enabled: bool,
    /// What replays of failed broker events are applied with.
    #[cfg(feature = "processing")]
    pub(crate) broker_events: crate::inbound::kafka_consumer::KafkaProcessingContext,
    /// Admits each received batch against the backfill cap and pause.
    pub backfill_gate: crate::domain::backfill_gate::BackfillGate,
    /// The most messages one receive takes, the batch's share of the cap.
    pub messages_per_receive: u32,
}

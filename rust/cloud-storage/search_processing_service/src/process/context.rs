use std::sync::Arc;

#[derive(Clone)]
pub struct SearchProcessingContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub worker: Arc<sqs_worker::SQSWorker>,
    pub document_storage_bucket: String,
    pub s3_client: Arc<s3_client::S3>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub comms_service_client: Arc<comms_service_client::CommsServiceClient>,
    pub lexical_client: Arc<lexical_client::LexicalClient>,
    pub email_client: Arc<email_service_client::EmailServiceClient>,
}

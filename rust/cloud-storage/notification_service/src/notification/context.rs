use connection_gateway_client::client::ConnectionGatewayClient;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct QueueWorkerContext {
    pub db: PgPool,
    pub worker: Arc<sqs_worker::SQSWorker>,
    pub conn_gateway_client: Arc<ConnectionGatewayClient>,
    pub ses_client: Arc<ses_client::Ses>,
    pub sns_client: Arc<sns_client::SNS>,
    pub macro_cache_client: Arc<macro_cache_client::MacroCache>,
}

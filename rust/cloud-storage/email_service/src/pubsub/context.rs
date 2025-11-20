use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use document_storage_service_client::DocumentStorageServiceClient;
use gmail_client::GmailClient;
use macro_notify::MacroNotifyClient;
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;

#[derive(Clone)]
pub struct PubSubContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub sqs_client: sqs_client::SQS,
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub macro_notify_client: MacroNotifyClient,
    pub sfs_client: StaticFileServiceClient,
    pub connection_gateway_client: ConnectionGatewayClient,
    pub dss_client: DocumentStorageServiceClient,
    pub notifications_enabled: bool,
}

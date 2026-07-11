use connection_gateway_client::client::ConnectionGatewayClient;
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;

#[derive(Clone)]
pub struct SFSUploaderContext {
    pub db: PgPool,
    pub sfs_client: StaticFileServiceClient,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub connection_gateway_client: ConnectionGatewayClient,
}

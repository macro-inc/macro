use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;

#[derive(Clone)]
pub struct SFSDeleteContext {
    pub db: PgPool,
    pub sfs_client: StaticFileServiceClient,
    pub sqs_worker: sqs_worker::SQSWorker,
}

use std::sync::Arc;

use macro_redis_cluster_client::Redis;
use sqlx::PgPool;

use crate::config::Config;

#[derive(Clone)]
pub struct QueueWorkerContext {
    pub worker: Arc<sqs_worker::SQSWorker>,
    pub db: PgPool,
    pub comms_db: PgPool,
    pub s3_client: Arc<s3_client::S3>,
    pub redis_client: Arc<Redis>,
    pub sync_service_client: Arc<sync_service_client::SyncServiceClient>,
    pub config: Config,
}

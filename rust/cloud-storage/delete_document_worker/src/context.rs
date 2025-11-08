use std::sync::Arc;

use macro_redis_cluster_client::Redis;

use crate::config::Config;

#[derive(Clone)]
pub struct QueueWorkerContext {
    pub worker: Arc<sqs_worker::SQSWorker>,
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub s3_client: Arc<s3_client::S3>,
    pub redis_client: Arc<Redis>,
    pub sync_service_client: Arc<sync_service_client::SyncServiceClient>,
    pub comms_service_client: Arc<comms_service_client::CommsServiceClient>,
    pub properties_service_client: Arc<properties_service_client::PropertiesServiceClient>,
    pub config: Config,
}

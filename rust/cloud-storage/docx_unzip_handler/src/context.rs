use std::sync::Arc;

use macro_redis_cluster_client::Redis;

use crate::config::Config;

#[derive(Clone)]
pub struct Context {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub s3_client: Arc<s3_client::S3>,
    pub lambda_client: Arc<lambda_client::Lambda>,
    pub redis_client: Arc<Redis>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub config: Config,
}

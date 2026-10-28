use std::sync::Arc;

use crate::config::Config;

#[derive(Clone)]
pub struct Context {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub s3_client: Arc<s3_client::S3>,
    pub lambda_client: Arc<lambda_client::Lambda>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub config: Config,
}

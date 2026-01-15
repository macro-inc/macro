use crate::config;
use std::sync::Arc;

/// Context for refresh handler
#[derive(Clone)]
pub struct Context {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub config: config::Config,
}

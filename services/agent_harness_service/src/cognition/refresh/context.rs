use std::sync::Arc;

#[derive(Clone)]
pub struct Context {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub sqs_client: Arc<sqs_client::SQS>,
}

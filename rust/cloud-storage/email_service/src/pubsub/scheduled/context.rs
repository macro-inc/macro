use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use gmail_client::GmailClient;
use sqlx::PgPool;

#[derive(Clone)]
pub struct ScheduledContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
}

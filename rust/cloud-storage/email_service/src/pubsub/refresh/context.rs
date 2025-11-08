use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use gmail_client::GmailClient;
use sqlx::PgPool;
use sqs_client::SQS;

#[derive(Clone)]
pub struct RefreshContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub sqs_client: SQS,
}

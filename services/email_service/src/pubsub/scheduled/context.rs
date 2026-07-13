use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use gmail_client::GmailClient;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use sqlx::PgPool;

#[derive(Clone)]
pub struct ScheduledContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub s3_client: s3_client::S3,
    pub attachment_bucket: String,
    pub macro_event_broker: MacroEventBrokerService<KafkaEventPublisher>,
}

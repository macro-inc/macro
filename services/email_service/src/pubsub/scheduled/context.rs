use crate::outbound::email_api::GmailApi;
use crate::pubsub::context::PubSubEventBroker;
use sqlx::PgPool;

#[derive(Clone)]
pub struct ScheduledContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub email_api: GmailApi,
    pub s3_client: s3_client::S3,
    pub attachment_bucket: String,
    pub macro_event_broker: PubSubEventBroker,
}

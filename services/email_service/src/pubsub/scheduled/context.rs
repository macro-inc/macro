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

impl ScheduledContext {
    /// Compose the worker's persistence/provider adapter without holding a DB transaction.
    pub fn delivery_adapter(
        &self,
    ) -> crate::outbound::scheduled_delivery::ScheduledDeliveryAdapter {
        crate::outbound::scheduled_delivery::ScheduledDeliveryAdapter {
            db: self.db.clone(),
            email_api: self.email_api.clone(),
            s3_client: self.s3_client.clone(),
            attachment_bucket: self.attachment_bucket.clone(),
            macro_event_broker: self.macro_event_broker.clone(),
        }
    }
}

use crate::domain::models::messages::ContactsNodes;
use crate::domain::ports::ContactsIngressQueue;
use rootcause::Report;

/// SQS-backed implementation of [`ContactsIngressQueue`].
#[derive(Clone)]
pub struct SqsContactsQueue {
    client: aws_sdk_sqs::Client,
    queue_url: String,
}

impl SqsContactsQueue {
    /// Creates a new queue adapter pointing at the given SQS queue URL.
    pub fn new(client: aws_sdk_sqs::Client, queue_url: String) -> Self {
        Self { client, queue_url }
    }
}

impl ContactsIngressQueue for SqsContactsQueue {
    #[tracing::instrument(skip(self, message), err)]
    async fn publish(&self, message: ContactsNodes) -> Result<(), Report> {
        let body = serde_json::to_string(&message)?;
        self.client
            .send_message()
            .queue_url(&self.queue_url)
            .message_body(body)
            .send()
            .await?;
        Ok(())
    }
}

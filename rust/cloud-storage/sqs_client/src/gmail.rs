use crate::SQS;
use models_email::gmail::webhook::WebhookPubsubMessage;

impl SQS {
    pub fn gmail_webhook_queue(mut self, gmail_webhook_queue: &str) -> Self {
        self.gmail_webhook_queue = Some(gmail_webhook_queue.to_string());
        self
    }

    /// Sends a notification message to the Gmail webhook queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_gmail_webhook_notification(
        &self,
        message: WebhookPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(gmail_webhook_queue) = &self.gmail_webhook_queue {
            return enqueue_webhook_notification(&self.inner, gmail_webhook_queue, message).await;
        }
        Err(anyhow::anyhow!("gmail_webhook_queue is not configured"))
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_webhook_notification(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: WebhookPubsubMessage,
) -> anyhow::Result<()> {
    let message_str = serde_json::to_string(&message)?;

    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;
    Ok(())
}

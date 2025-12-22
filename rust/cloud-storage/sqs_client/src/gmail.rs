use crate::SQS;
use models_email::gmail::inbox_sync::InboxSyncPubsubMessage;

impl SQS {
    pub fn gmail_inbox_sync_queue(mut self, gmail_inbox_sync_queue: &str) -> Self {
        self.gmail_inbox_sync_queue = Some(gmail_inbox_sync_queue.to_string());
        self
    }

    pub fn gmail_inbox_sync_retry_queue(mut self, gmail_inbox_sync_retry_queue: &str) -> Self {
        self.gmail_inbox_sync_retry_queue = Some(gmail_inbox_sync_retry_queue.to_string());
        self
    }

    /// Sends a notification message to the Gmail inbox sync queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_gmail_inbox_sync_notification(
        &self,
        message: InboxSyncPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(gmail_inbox_sync_queue) = &self.gmail_inbox_sync_queue {
            return enqueue_inbox_sync_notification(&self.inner, gmail_inbox_sync_queue, message)
                .await;
        }
        anyhow::bail!("gmail_inbox_sync__queue is not configured")
    }

    /// Sends a notification message to the Gmail retry inbox sync queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_gmail_retry_inbox_sync_notification(
        &self,
        message: InboxSyncPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(gmail_inbox_sync_retry_queue) = &self.gmail_inbox_sync_retry_queue {
            return enqueue_inbox_sync_notification(
                &self.inner,
                gmail_inbox_sync_retry_queue,
                message,
            )
            .await;
        }
        anyhow::bail!("gmail_inbox_sync_retry_queue is not configured")
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_inbox_sync_notification(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: InboxSyncPubsubMessage,
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

use crate::{MAX_BATCH_SIZE, SQS};
use anyhow::Context;
use aws_sdk_sqs::types::SendMessageBatchRequestEntry;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
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

    pub fn gmail_ops_queue(mut self, gmail_ops_queue: &str) -> Self {
        self.gmail_ops_queue = Some(gmail_ops_queue.to_string());
        self
    }

    pub fn gmail_ops_retry_queue(mut self, gmail_ops_retry_queue: &str) -> Self {
        self.gmail_ops_retry_queue = Some(gmail_ops_retry_queue.to_string());
        self
    }

    /// Sends a notification message to the Gmail inbox sync queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_gmail_inbox_sync_notification(
        &self,
        message: InboxSyncPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(gmail_inbox_sync_queue) = &self.gmail_inbox_sync_queue {
            return enqueue_notification(&self.inner, gmail_inbox_sync_queue, &message).await;
        }
        anyhow::bail!("gmail_inbox_sync_queue is not configured")
    }

    /// Sends a notification message to the Gmail retry inbox sync queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_gmail_retry_inbox_sync_notification(
        &self,
        message: InboxSyncPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(gmail_inbox_sync_retry_queue) = &self.gmail_inbox_sync_retry_queue {
            return enqueue_notification(&self.inner, gmail_inbox_sync_retry_queue, &message).await;
        }
        anyhow::bail!("gmail_inbox_sync_retry_queue is not configured")
    }

    /// Sends a message to the Gmail operations queue
    #[tracing::instrument(skip(self), err)]
    pub async fn enqueue_gmail_ops_notification(
        &self,
        message: GmailOpsPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(gmail_ops_queue) = &self.gmail_ops_queue {
            return enqueue_notification(&self.inner, gmail_ops_queue, &message).await;
        }
        anyhow::bail!("gmail_ops_queue is not configured")
    }

    /// Sends a batch of messages to the Gmail operations queue.
    /// Messages are batched into groups of up to 10 (SQS limit).
    #[tracing::instrument(skip(self, messages), fields(message_count = messages.len()), err)]
    pub async fn enqueue_gmail_ops_notifications_batch(
        &self,
        messages: Vec<GmailOpsPubsubMessage>,
    ) -> anyhow::Result<()> {
        let Some(gmail_ops_queue) = &self.gmail_ops_queue else {
            anyhow::bail!("gmail_ops_queue is not configured")
        };

        if messages.is_empty() {
            return Ok(());
        }

        let entries: Vec<SendMessageBatchRequestEntry> = messages
            .iter()
            .enumerate()
            .map(|(i, msg)| {
                let body = serde_json::to_string(msg)?;
                SendMessageBatchRequestEntry::builder()
                    .id(i.to_string())
                    .message_body(body)
                    .build()
                    .context("Failed to build batch entry")
            })
            .collect::<anyhow::Result<Vec<_>>>()?;

        for chunk in entries.chunks(MAX_BATCH_SIZE) {
            let result = self
                .inner
                .send_message_batch()
                .queue_url(gmail_ops_queue)
                .set_entries(Some(chunk.to_vec()))
                .send()
                .await
                .context("Failed to send gmail ops batch")?;

            let failed = result.failed();
            if !failed.is_empty() {
                tracing::error!(
                    failed_count = failed.len(),
                    "Partial failure in gmail ops batch send"
                );
                anyhow::bail!(
                    "Partial batch failure: {} messages failed to send",
                    failed.len()
                );
            }
        }

        Ok(())
    }

    /// Sends a message to the Gmail operations retry queue
    #[tracing::instrument(skip(self), err)]
    pub async fn enqueue_gmail_ops_retry_notification(
        &self,
        message: GmailOpsPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(gmail_ops_retry_queue) = &self.gmail_ops_retry_queue {
            return enqueue_notification(&self.inner, gmail_ops_retry_queue, &message).await;
        }
        anyhow::bail!("gmail_ops_retry_queue is not configured")
    }
}

#[tracing::instrument(skip(sqs_client))]
async fn enqueue_notification<T: serde::Serialize + std::fmt::Debug>(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: &T,
) -> anyhow::Result<()> {
    let message_str = serde_json::to_string(message)?;

    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;
    Ok(())
}

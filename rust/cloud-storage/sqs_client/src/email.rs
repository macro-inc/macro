use crate::SQS;
use models_email::email::service::backfill::BackfillPubsubMessage;
use models_email::email::service::pubsub::RefreshMessage;
use models_email::service::pubsub::{SFSUploaderMessage, ScheduledPubsubMessage};

impl SQS {
    pub fn email_refresh_queue(mut self, email_refresh_queue: &str) -> Self {
        self.email_refresh_queue = Some(email_refresh_queue.to_string());
        self
    }

    pub fn email_scheduled_queue(mut self, email_scheduled_queue: &str) -> Self {
        self.email_scheduled_queue = Some(email_scheduled_queue.to_string());
        self
    }

    pub fn email_backfill_queue(mut self, email_backfill_queue: &str) -> Self {
        self.email_backfill_queue = Some(email_backfill_queue.to_string());
        self
    }

    pub fn sfs_uploader_queue(mut self, email_sfs_uploader_queue: &str) -> Self {
        self.email_sfs_uploader_queue = Some(email_sfs_uploader_queue.to_string());
        self
    }

    /// Sends a notification message to the email refresh queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_email_refresh_notification(
        &self,
        message: RefreshMessage,
    ) -> anyhow::Result<()> {
        if let Some(email_refresh_queue) = &self.email_refresh_queue {
            return enqueue_refresh_notification(&self.inner, email_refresh_queue, message).await;
        }
        Err(anyhow::anyhow!("email_refresh_queue is not configured"))
    }

    /// Sends a message to the email backfill queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_email_backfill_message(
        &self,
        message: BackfillPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(email_backfill_queue) = &self.email_backfill_queue {
            return enqueue_backfill_message(&self.inner, email_backfill_queue, message).await;
        }
        Err(anyhow::anyhow!("email_backfill_queue is not configured"))
    }

    /// Sends a message to the email backfill queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_email_scheduled_message(
        &self,
        message: ScheduledPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(email_scheduled_queue) = &self.email_scheduled_queue {
            return enqueue_scheduled_message(&self.inner, email_scheduled_queue, message).await;
        }
        Err(anyhow::anyhow!("email_scheduled_queue is not configured"))
    }

    /// Sends a notification message to the email sfs uploader queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_email_sfs_uploader_message(
        &self,
        message: SFSUploaderMessage,
    ) -> anyhow::Result<()> {
        if let Some(queue) = &self.email_sfs_uploader_queue {
            return enqueue_sfs_uploader_message(&self.inner, queue, message).await;
        }
        Err(anyhow::anyhow!(
            "email_sfs_uploader_queue is not configured"
        ))
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_refresh_notification(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: RefreshMessage,
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

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_backfill_message(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: BackfillPubsubMessage,
) -> anyhow::Result<()> {
    let message_str = serde_json::to_string(&message)?;

    // Send the message with the serialized body
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;

    Ok(())
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_scheduled_message(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: ScheduledPubsubMessage,
) -> anyhow::Result<()> {
    let message_str = serde_json::to_string(&message)?;
    let message_db_id = message.message_id.to_string();

    // Send the message with the serialized body
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .message_group_id(message_db_id.clone())
        .message_deduplication_id(message_db_id)
        .send()
        .await?;

    Ok(())
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_sfs_uploader_message(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: SFSUploaderMessage,
) -> anyhow::Result<()> {
    let message_str = serde_json::to_string(&message)?;

    // Send the message with the serialized body
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;

    Ok(())
}

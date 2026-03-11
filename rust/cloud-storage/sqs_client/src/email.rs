use crate::SQS;
use email::domain::ports::EmailMessageEnqueuer;
use models_email::email::service::backfill::BackfillPubsubMessage;
use models_email::email::service::pubsub::LinkManagerMessage;
use models_email::service::pubsub::{SFSUploaderMessage, ScheduledPubsubMessage};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

impl SQS {
    pub fn email_link_manager_queue(mut self, link_manager_queue: &str) -> Self {
        self.link_manager_queue = Some(link_manager_queue.to_string());
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

    #[cfg(feature = "sfs_uploader")]
    pub fn sfs_uploader_queue(mut self, email_sfs_uploader_queue: &str) -> Self {
        self.email_sfs_uploader_queue = Some(email_sfs_uploader_queue.to_string());
        self
    }

    #[cfg(feature = "sfs_delete")]
    pub fn sfs_delete_queue(mut self, email_sfs_delete_queue: &str) -> Self {
        self.email_sfs_delete_queue = Some(email_sfs_delete_queue.to_string());
        self
    }

    /// Sends a notification message to the email refresh queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_link_manager_notification(
        &self,
        message: LinkManagerMessage,
    ) -> anyhow::Result<()> {
        if let Some(link_manager_queue) = &self.link_manager_queue {
            return enqueue_link_manager_notification(&self.inner, link_manager_queue, message)
                .await;
        }
        Err(anyhow::anyhow!("link_manager_queue is not configured"))
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
        delay_seconds: Option<i32>,
    ) -> anyhow::Result<()> {
        if let Some(email_scheduled_queue) = &self.email_scheduled_queue {
            return enqueue_scheduled_message(
                &self.inner,
                email_scheduled_queue,
                message,
                delay_seconds,
            )
            .await;
        }
        Err(anyhow::anyhow!("email_scheduled_queue is not configured"))
    }

    /// Sends a notification message to the email sfs uploader queue
    #[cfg(feature = "sfs_uploader")]
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

    /// Sends a message to the sfs delete queue
    #[cfg(feature = "sfs_delete")]
    #[tracing::instrument(skip(self), err)]
    pub async fn enqueue_sfs_delete_message(
        &self,
        message: SFSDeleteMessage,
    ) -> anyhow::Result<()> {
        if let Some(queue) = &self.email_sfs_delete_queue {
            return enqueue_sfs_delete_message(&self.inner, queue, message).await;
        }
        anyhow::bail!("email_sfs_delete_queue is not configured")
    }
}

impl EmailMessageEnqueuer for SQS {
    type Err = anyhow::Error;

    async fn enqueue_scheduled_message(
        &self,
        link_id: Uuid,
        message_id: Uuid,
        delay_seconds: Option<i32>,
    ) -> Result<(), Self::Err> {
        self.enqueue_email_scheduled_message(
            ScheduledPubsubMessage {
                link_id,
                message_id,
            },
            delay_seconds,
        )
        .await
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_link_manager_notification(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: LinkManagerMessage,
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
    delay_seconds: Option<i32>,
) -> anyhow::Result<()> {
    let message_str = serde_json::to_string(&message)?;

    let mut request = sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str);

    if let Some(delay) = delay_seconds {
        request = request.delay_seconds(delay);
    }

    request.send().await?;

    Ok(())
}

#[cfg(feature = "sfs_uploader")]
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

#[cfg(feature = "sfs_delete")]
#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_sfs_delete_message(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: SFSDeleteMessage,
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

/// The message we send to the sfs_delete
#[cfg(feature = "sfs_delete")]
#[derive(Debug, Serialize, Deserialize)]
pub struct SFSDeleteMessage {
    /// The ID of the row in email_attachments_sfs
    pub db_id: Uuid,
    /// The ID of the item in SFS
    pub sfs_id: Uuid,
}

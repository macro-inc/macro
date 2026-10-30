use crate::SQS;
use email::domain::ports::EmailMessageEnqueuer;
use models_email::email::service::backfill::BackfillPubsubMessage;
use models_email::email::service::crm_cleanup::CrmCleanupPubsubMessage;
pub use models_email::email::service::pubsub::LinkManagerMessage;
#[cfg(feature = "sfs_uploader")]
use models_email::service::pubsub::SFSUploaderMessage;
use models_email::service::pubsub::ScheduledPubsubMessage;
use uuid::Uuid;

/// Message attribute counting how often a backfill operation has been sent
/// back to its queue by [`SQS::defer_email_backfill_message`].
pub const BACKFILL_DEFERRALS_ATTRIBUTE: &str = "deferrals";

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

    /// Send Gmail label writes as `ModifyMessageLabelsBatch` messages. Enable
    /// only once every gmail_ops worker decodes them; workers released before
    /// the batch form delete it. Off, each message is its own operation.
    pub fn gmail_label_write_batches(mut self, enabled: bool) -> Self {
        self.gmail_label_write_batches = enabled;
        self
    }

    /// The gmail_ops queue messages for one label write, in the format this
    /// client is configured for.
    fn gmail_label_write_messages(
        &self,
        link_id: Uuid,
        messages: Vec<(Uuid, String)>,
        labels_to_add: Vec<String>,
        labels_to_remove: Vec<String>,
        pending_write_id: Uuid,
    ) -> Vec<models_email::gmail::gmail_ops::GmailOpsPubsubMessage> {
        use models_email::gmail::gmail_ops::{
            GmailMessageRef, GmailOpsPubsubMessage, label_write_operations,
        };

        let messages = messages
            .into_iter()
            .map(|(db_message_id, provider_message_id)| GmailMessageRef {
                db_message_id,
                provider_message_id,
            })
            .collect();
        label_write_operations(
            messages,
            labels_to_add,
            labels_to_remove,
            pending_write_id,
            self.gmail_label_write_batches,
        )
        .into_iter()
        .map(|operation| GmailOpsPubsubMessage { link_id, operation })
        .collect()
    }

    pub fn email_crm_cleanup_queue(mut self, email_crm_cleanup_queue: &str) -> Self {
        self.email_crm_cleanup_queue = Some(email_crm_cleanup_queue.to_string());
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
        anyhow::bail!("link_manager_queue is not configured")
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

    /// Sends a backfill operation back to the backfill queue as a new message
    /// that becomes visible after `delay_seconds`. Unlike waiting out the
    /// visibility timeout, the wait uses none of the operation's deliveries.
    /// `deferrals` is recorded in [`BACKFILL_DEFERRALS_ATTRIBUTE`].
    #[tracing::instrument(skip(self), err)]
    pub async fn defer_email_backfill_message(
        &self,
        message: &BackfillPubsubMessage,
        delay_seconds: i32,
        deferrals: u32,
    ) -> anyhow::Result<()> {
        let Some(email_backfill_queue) = &self.email_backfill_queue else {
            anyhow::bail!("email_backfill_queue is not configured");
        };
        let deferrals = aws_sdk_sqs::types::MessageAttributeValue::builder()
            .data_type("Number")
            .string_value(deferrals.to_string())
            .build()?;
        self.inner
            .send_message()
            .queue_url(email_backfill_queue)
            .message_body(serde_json::to_string(&message)?)
            .delay_seconds(delay_seconds)
            .message_attributes(BACKFILL_DEFERRALS_ATTRIBUTE, deferrals)
            .send()
            .await?;
        Ok(())
    }

    /// Sends a message to the email crm cleanup queue
    #[tracing::instrument(skip(self), err)]
    pub async fn enqueue_email_crm_cleanup_message(
        &self,
        message: CrmCleanupPubsubMessage,
    ) -> anyhow::Result<()> {
        if let Some(email_crm_cleanup_queue) = &self.email_crm_cleanup_queue {
            return enqueue_crm_cleanup_message(&self.inner, email_crm_cleanup_queue, message)
                .await;
        }
        anyhow::bail!("email_crm_cleanup_queue is not configured")
    }

    /// Sends a message to the email scheduled queue
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

    const MAX_LABEL_WRITE_MESSAGES: usize =
        models_email::gmail::gmail_ops::MAX_BATCH_MODIFY_MESSAGES;

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

    #[tracing::instrument(
        skip(self, messages, labels_to_add, labels_to_remove),
        fields(message_count = messages.len()),
        err
    )]
    async fn enqueue_gmail_ops_modify_labels_batch(
        &self,
        link_id: Uuid,
        messages: Vec<(Uuid, String)>,
        labels_to_add: Vec<String>,
        labels_to_remove: Vec<String>,
        pending_write_id: Uuid,
    ) -> Result<(), Self::Err> {
        let messages = self.gmail_label_write_messages(
            link_id,
            messages,
            labels_to_add,
            labels_to_remove,
            pending_write_id,
        );
        if !self.gmail_label_write_batches {
            return self.enqueue_gmail_ops_notifications_batch(messages).await;
        }
        // A full batch is ~100 KB, so each goes out alone rather than in an
        // SQS batch whose 256 KB cap is shared by all its entries.
        for message in messages {
            self.enqueue_gmail_ops_notification(message).await?;
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, email_address), err)]
    async fn enqueue_gmail_ops_block_sender(
        &self,
        link_id: Uuid,
        email_address: String,
    ) -> Result<(), Self::Err> {
        use models_email::gmail::gmail_ops::{
            BlockSenderPayload, GmailOpsOperation, GmailOpsPubsubMessage,
        };

        self.enqueue_gmail_ops_notification(GmailOpsPubsubMessage {
            link_id,
            operation: GmailOpsOperation::BlockSender(BlockSenderPayload { email_address }),
        })
        .await
    }

    #[tracing::instrument(skip(self, email_address), err)]
    async fn enqueue_gmail_ops_unblock_sender(
        &self,
        link_id: Uuid,
        email_address: String,
    ) -> Result<(), Self::Err> {
        use models_email::gmail::gmail_ops::{
            GmailOpsOperation, GmailOpsPubsubMessage, UnblockSenderPayload,
        };

        self.enqueue_gmail_ops_notification(GmailOpsPubsubMessage {
            link_id,
            operation: GmailOpsOperation::UnblockSender(UnblockSenderPayload { email_address }),
        })
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
pub async fn enqueue_crm_cleanup_message(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: CrmCleanupPubsubMessage,
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
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SFSDeleteMessage {
    /// The ID of the row in email_attachments_sfs
    pub db_id: Uuid,
    /// The ID of the item in SFS
    pub sfs_id: Uuid,
}

#[cfg(test)]
mod test;

//! SQS adapter for [`EmailMessageEnqueuer`].

use crate::domain::ports::EmailMessageEnqueuer;
use email_types::gmail::gmail_ops::{
    BlockSenderPayload, GmailOpsOperation, GmailOpsPubsubMessage, MAX_BATCH_MODIFY_MESSAGES,
    UnblockSenderPayload,
};
use email_types::service::pubsub::ScheduledPubsubMessage;
use sqs_client::SQS;
use uuid::Uuid;

impl EmailMessageEnqueuer for SQS {
    type Err = anyhow::Error;

    const MAX_LABEL_WRITE_MESSAGES: usize = MAX_BATCH_MODIFY_MESSAGES;

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
        self.enqueue_gmail_label_write(
            link_id,
            messages,
            labels_to_add,
            labels_to_remove,
            pending_write_id,
        )
        .await
    }

    #[tracing::instrument(skip(self, email_address), err)]
    async fn enqueue_gmail_ops_block_sender(
        &self,
        link_id: Uuid,
        email_address: String,
    ) -> Result<(), Self::Err> {
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
        self.enqueue_gmail_ops_notification(GmailOpsPubsubMessage {
            link_id,
            operation: GmailOpsOperation::UnblockSender(UnblockSenderPayload { email_address }),
        })
        .await
    }
}

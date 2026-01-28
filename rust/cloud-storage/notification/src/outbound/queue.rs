//! SQS queue adapter for notification delivery.

use aws_sdk_sqs::Client as SqsClient;
use rootcause::Report;
use serde::Serialize;

use crate::domain::models::queue_message::{QueueMessage, RawQueueMessage};
use crate::domain::ports::NotificationQueue;

/// SQS-backed implementation of the notification queue port.
pub struct SqsNotificationQueue {
    client: SqsClient,
    queue_url: String,
}

impl SqsNotificationQueue {
    /// Create a new SQS notification queue adapter.
    pub fn new(client: SqsClient, queue_url: String) -> Self {
        Self { client, queue_url }
    }
}

impl NotificationQueue for SqsNotificationQueue {
    async fn publish<T: Serialize + Send + Sync>(
        &self,
        messages: &[QueueMessage<'_, T>],
    ) -> Result<(), Report> {
        for message in messages {
            let body = serde_json::to_string(message)?;
            self.client
                .send_message()
                .queue_url(&self.queue_url)
                .message_body(body)
                .send()
                .await?;
        }
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        let result = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .max_number_of_messages(10)
            .wait_time_seconds(20)
            .send()
            .await?;

        let messages = result
            .messages
            .unwrap_or_default()
            .into_iter()
            .filter_map(|msg| {
                let body_str = msg.body?;
                let body = serde_json::from_str(&body_str).ok()?;
                let receipt_handle = msg.receipt_handle?;
                Some(RawQueueMessage {
                    body,
                    receipt_handle,
                })
            })
            .collect();

        Ok(messages)
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        self.client
            .delete_message()
            .queue_url(&self.queue_url)
            .receipt_handle(receipt_handle)
            .send()
            .await?;
        Ok(())
    }
}

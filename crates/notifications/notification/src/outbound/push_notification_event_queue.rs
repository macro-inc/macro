//! SQS adapter for receiving push notification event messages.

use crate::domain::models::push_notification_event::RawPushNotificationEventMessage;
use crate::domain::ports::PushNotificationEventQueue;
use rootcause::Report;

/// SQS-backed queue for receiving push notification platform events.
pub struct SqsPushNotificationEventQueue {
    client: aws_sdk_sqs::Client,
    queue_url: String,
    max_messages: i32,
    wait_time_seconds: i32,
}

impl SqsPushNotificationEventQueue {
    /// Create a new SQS push notification event queue.
    pub fn new(
        client: aws_sdk_sqs::Client,
        queue_url: String,
        max_messages: i32,
        wait_time_seconds: i32,
    ) -> Self {
        Self {
            client,
            queue_url,
            max_messages,
            wait_time_seconds,
        }
    }
}

impl PushNotificationEventQueue for SqsPushNotificationEventQueue {
    #[tracing::instrument(err, skip(self))]
    async fn receive_messages(&self) -> Result<Vec<RawPushNotificationEventMessage>, Report> {
        let output = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .max_number_of_messages(self.max_messages)
            .wait_time_seconds(self.wait_time_seconds)
            .send()
            .await?;

        let messages = output
            .messages
            .unwrap_or_default()
            .into_iter()
            .map(|m| RawPushNotificationEventMessage {
                body: m.body,
                receipt_handle: m.receipt_handle,
            })
            .collect();

        Ok(messages)
    }

    #[tracing::instrument(err, skip(self))]
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

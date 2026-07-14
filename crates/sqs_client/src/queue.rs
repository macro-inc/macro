//! Generic SQS transport operations shared by queue-specific adapters.

use crate::SQS;

/// Raw message returned from an SQS receive operation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceivedMessage {
    /// Queue-assigned message identifier, when present.
    pub message_id: Option<String>,
    /// Unparsed message body, when present.
    pub body: Option<String>,
    /// Receipt handle used to delete or delay the message, when present.
    pub receipt_handle: Option<String>,
}

impl SQS {
    /// Send one message to a FIFO queue.
    pub async fn send_fifo_message(
        &self,
        queue_url: &str,
        message_body: String,
        message_group_id: String,
        message_deduplication_id: String,
    ) -> anyhow::Result<()> {
        self.inner
            .send_message()
            .queue_url(queue_url)
            .message_body(message_body)
            .message_group_id(message_group_id)
            .message_deduplication_id(message_deduplication_id)
            .send()
            .await?;

        Ok(())
    }

    /// Receive a batch of unparsed messages from a queue.
    pub async fn receive_messages(
        &self,
        queue_url: &str,
        max_number_of_messages: i32,
        wait_time_seconds: i32,
    ) -> anyhow::Result<Vec<ReceivedMessage>> {
        let output = self
            .inner
            .receive_message()
            .queue_url(queue_url)
            .max_number_of_messages(max_number_of_messages)
            .wait_time_seconds(wait_time_seconds)
            .send()
            .await?;

        Ok(output
            .messages
            .unwrap_or_default()
            .into_iter()
            .map(|message| ReceivedMessage {
                message_id: message.message_id,
                body: message.body,
                receipt_handle: message.receipt_handle,
            })
            .collect())
    }

    /// Delete a message from a queue using its receipt handle.
    pub async fn delete_message(
        &self,
        queue_url: &str,
        receipt_handle: &str,
    ) -> anyhow::Result<()> {
        self.inner
            .delete_message()
            .queue_url(queue_url)
            .receipt_handle(receipt_handle)
            .send()
            .await?;

        Ok(())
    }

    /// Change the visibility timeout for a received message.
    pub async fn change_message_visibility(
        &self,
        queue_url: &str,
        receipt_handle: &str,
        visibility_timeout: i32,
    ) -> anyhow::Result<()> {
        self.inner
            .change_message_visibility()
            .queue_url(queue_url)
            .receipt_handle(receipt_handle)
            .visibility_timeout(visibility_timeout)
            .send()
            .await?;

        Ok(())
    }
}

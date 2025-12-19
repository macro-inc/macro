//! This module contains the logic for implementing the MessageReceiver for search queue messages

use pollux::{MessageEnvelope, MessageReceiver};

/// The receiver to poll for messages from the search queue
pub struct Receiver {
    /// The sqs client.
    pub client: aws_sdk_sqs::Client,
    /// The queue url.
    pub queue_url: String,
    /// The maximum number of messages to receive in a single poll.
    pub max_messages: i32,
    /// The maximum time to wait in a poll call to receive any messages.
    pub wait_time_seconds: i32,
}

impl MessageReceiver for Receiver {
    type Error = anyhow::Error;
    type Payload = aws_sdk_sqs::types::Message;
    type AckInfo = Option<String>;

    async fn receive_messages(
        &self,
    ) -> Result<Vec<MessageEnvelope<Self::Payload, Self::AckInfo>>, Self::Error> {
        let messages = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .wait_time_seconds(self.wait_time_seconds)
            .max_number_of_messages(self.max_messages)
            .set_message_attribute_names(Some(vec!["*".to_string()])) // Needed to get all the message attributes
            .send()
            .await?
            .messages
            .unwrap_or_default();

        if messages.is_empty() {
            return Ok(vec![]);
        }

        let envelopes = messages
            .into_iter()
            .map(|m| {
                let ack_info = m.receipt_handle.clone();
                MessageEnvelope {
                    payload: m,
                    ack_info,
                }
            })
            .collect();

        Ok(envelopes)
    }

    async fn acknowledge(&self, ack_info: Self::AckInfo) -> Result<(), Self::Error> {
        if let Some(receipt_handle) = ack_info {
            self.client
                .delete_message()
                .queue_url(&self.queue_url)
                .receipt_handle(receipt_handle.as_str())
                .send()
                .await?;
        }

        Ok(())
    }
}

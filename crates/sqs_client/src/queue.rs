//! Generic SQS transport operations shared by queue-specific adapters.

use crate::SQS;
use aws_sdk_sqs::types::{MessageAttributeValue, MessageSystemAttributeName};
use std::collections::HashMap;

/// The data type of an SQS message attribute holding text.
const STRING_ATTRIBUTE: &str = "String";

/// Raw message returned from an SQS receive operation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceivedMessage {
    /// Queue-assigned message identifier, when present.
    pub message_id: Option<String>,
    /// Unparsed message body, when present.
    pub body: Option<String>,
    /// Receipt handle used to delete or delay the message, when present.
    pub receipt_handle: Option<String>,
    /// How many times the message has been received, this receipt included,
    /// when SQS reported it.
    pub receive_count: Option<u32>,
    /// The message's string attributes, by name.
    pub string_attributes: HashMap<String, String>,
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

    /// Send one message to a FIFO queue with string message attributes, which
    /// travel beside the body and which a receiver that does not read them
    /// ignores. Attributes with an empty value are left out, as SQS refuses
    /// them.
    pub async fn send_fifo_message_with_string_attributes(
        &self,
        queue_url: &str,
        message_body: String,
        message_group_id: String,
        message_deduplication_id: String,
        string_attributes: HashMap<String, String>,
    ) -> anyhow::Result<()> {
        let mut attributes = HashMap::with_capacity(string_attributes.len());
        for (name, value) in string_attributes {
            if value.is_empty() {
                continue;
            }
            let value = MessageAttributeValue::builder()
                .data_type(STRING_ATTRIBUTE)
                .string_value(value)
                .build()?;
            attributes.insert(name, value);
        }
        self.inner
            .send_message()
            .queue_url(queue_url)
            .message_body(message_body)
            .message_group_id(message_group_id)
            .message_deduplication_id(message_deduplication_id)
            .set_message_attributes((!attributes.is_empty()).then_some(attributes))
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
            .message_system_attribute_names(MessageSystemAttributeName::ApproximateReceiveCount)
            .message_attribute_names("All")
            .send()
            .await?;

        Ok(output
            .messages
            .unwrap_or_default()
            .into_iter()
            .map(|message| ReceivedMessage {
                receive_count: message
                    .attributes
                    .as_ref()
                    .and_then(|attributes| {
                        attributes.get(&MessageSystemAttributeName::ApproximateReceiveCount)
                    })
                    .and_then(|count| count.parse().ok()),
                string_attributes: message
                    .message_attributes
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|(_, value)| value.data_type == STRING_ATTRIBUTE)
                    .filter_map(|(name, value)| Some((name, value.string_value?)))
                    .collect(),
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

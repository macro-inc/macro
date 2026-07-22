//! Kafka message integration and MSK IAM support shared by adapters.

use rdkafka::Message;

use crate::MessageParts;

/// AWS MSK IAM authentication support for Kafka clients.
pub mod msk_iam;

impl<T: Message> MessageParts for T {
    fn key(&self) -> Option<&str> {
        Message::key(self).and_then(|key| std::str::from_utf8(key).ok())
    }

    fn payload(&self) -> Option<&[u8]> {
        Message::payload(self)
    }

    fn topic(&self) -> &str {
        Message::topic(self)
    }
}

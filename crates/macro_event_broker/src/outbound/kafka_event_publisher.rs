//! Kafka adapter for the [`EventPublisher`] port.
//!
//! The environment-aware Kafka producer transport lives in `kafka_util`; this
//! adapter maps that transport onto the macro event broker's domain port.

use kafka_util::{KafkaEventProducer, KafkaProducerError};
use macro_event_topics::Topic;
use rdkafka::Message;
use rdkafka::error::{KafkaError, RDKafkaErrorCode};

use crate::MessageParts;
use crate::domain::models::EventBrokerError;
use crate::domain::ports::EventPublisher;

/// Kafka-backed implementation of [`EventPublisher`].
#[derive(Clone)]
pub struct KafkaEventPublisher {
    producer: KafkaEventProducer,
}

impl KafkaEventPublisher {
    /// Builds an environment-aware Kafka event publisher.
    pub fn new(brokers: &str) -> Result<Self, KafkaProducerError> {
        Ok(Self {
            producer: KafkaEventProducer::from_env(brokers)?,
        })
    }
}

impl EventPublisher for KafkaEventPublisher {
    async fn publish<T: Topic>(
        &self,
        key: &str,
        event_type: Option<&str>,
        payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.producer
            .send(T::TOPIC_STR, key, event_type, payload)
            .await
            .map_err(publish_error)
    }
}

/// Tell a message no retry can deliver from a delivery that failed.
fn publish_error(error: KafkaError) -> EventBrokerError {
    match error.rdkafka_error_code() {
        Some(RDKafkaErrorCode::MessageSizeTooLarge) => {
            EventBrokerError::TooLarge(error.to_string())
        }
        _ => EventBrokerError::Publish(error.to_string()),
    }
}

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

#[cfg(test)]
mod test;

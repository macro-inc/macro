//! Kafka adapter for the [`EventPublisher`] port.
//!
//! Wraps an `rdkafka` [`FutureProducer`] to publish events. The broker address is
//! supplied by the caller (typically from environment configuration at the
//! consuming service), so no env wiring lives in this crate yet.

use std::time::Duration;

use macro_event_topics::Topic;
use rdkafka::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};

use crate::domain::models::EventBrokerError;
use crate::domain::ports::EventPublisher;

/// How long a record may sit in the producer queue before delivery is considered failed.
const MESSAGE_TIMEOUT_MS: &str = "5000";

/// How long [`EventPublisher::publish`] waits for delivery confirmation before timing out.
const SEND_TIMEOUT: Duration = Duration::from_secs(5);

/// Kafka-backed implementation of [`EventPublisher`].
pub struct KafkaEventPublisher {
    producer: FutureProducer,
}

impl KafkaEventPublisher {
    /// Build a producer connected to the given comma-separated `brokers` list.
    pub fn new(brokers: &str) -> Result<Self, EventBrokerError> {
        let producer: FutureProducer = ClientConfig::new()
            .set("bootstrap.servers", brokers)
            .set("message.timeout.ms", MESSAGE_TIMEOUT_MS)
            .create()
            .map_err(|e| EventBrokerError::Publish(format!("failed to create producer: {e}")))?;

        Ok(Self { producer })
    }
}

impl EventPublisher for KafkaEventPublisher {
    #[tracing::instrument(err, skip(self, payload), fields(topic = %topic.as_str(), key = %key))]
    async fn publish<T: Topic>(
        &self,
        topic: T,
        key: &str,
        payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        let record = FutureRecord::to(topic.as_str()).key(key).payload(payload);

        self.producer
            .send(record, SEND_TIMEOUT)
            .await
            .map_err(|(e, _)| EventBrokerError::Publish(e.to_string()))?;

        Ok(())
    }
}

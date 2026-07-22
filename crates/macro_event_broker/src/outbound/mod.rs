/// Kafka adapter implementing the [`EventPublisher`](crate::domain::ports::EventPublisher) port.
#[cfg(feature = "outbound")]
pub mod kafka_event_publisher;

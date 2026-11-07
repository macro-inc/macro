/// Kafka adapter implementing the [`EventConsumer`](crate::domain::ports::EventConsumer) port.
#[cfg(feature = "outbound")]
pub mod kafka_event_consumer;
/// Kafka adapter implementing the [`EventPublisher`](crate::domain::ports::EventPublisher) port.
#[cfg(feature = "outbound")]
pub mod kafka_event_publisher;
/// Tokio adapters implementing the [`Spawner`](crate::domain::ports::Spawner) port.
#[cfg(feature = "outbound")]
pub mod spawner;

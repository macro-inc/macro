/// Kafka adapter implementing the [`EventConsumer`](crate::domain::ports::EventConsumer) port.
#[cfg(feature = "outbound")]
pub mod kafka_event_consumer;
/// Kafka adapter implementing the [`EventPublisher`](crate::domain::ports::EventPublisher) port.
#[cfg(feature = "outbound")]
pub mod kafka_event_publisher;
/// Typed bounded-parallel Kafka event handler and delivery-policy adapter.
#[cfg(feature = "outbound")]
pub mod parallel_event_consumer;
/// Tokio adapters implementing the [`Spawner`](crate::domain::ports::Spawner) port.
#[cfg(feature = "outbound")]
pub mod spawner;

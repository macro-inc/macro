//! Outbound adapters used by realtime Soup services.

/// Current entity-access expansion adapter.
#[cfg(feature = "outbound")]
pub mod entity_access;
/// Kafka-backed realtime Soup publisher adapter.
#[cfg(feature = "outbound")]
pub mod kafka_publisher;
/// Independent Kafka consumer for recipient-targeted Soup messages.
#[cfg(feature = "consumer")]
pub mod soup_consumer;
/// User-scoped Soup item reader adapter.
#[cfg(feature = "outbound")]
pub mod soup_item_reader;

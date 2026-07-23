//! Outbound adapters used by realtime Soup fan-out.

/// Current entity-access expansion adapter.
pub mod entity_access;
/// Kafka-backed realtime Soup publisher adapter.
pub mod kafka_publisher;
/// User-scoped Soup item reader adapter.
pub mod soup_item_reader;

//! Inbound adapters that drive realtime Soup fan-out.

/// Kafka consumer for document update events.
pub mod kafka_consumer;
/// Independent Kafka consumer for recipient-targeted Soup messages.
pub mod soup_consumer;

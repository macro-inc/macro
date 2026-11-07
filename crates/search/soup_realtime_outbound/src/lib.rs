#![deny(missing_docs)]
//! Outbound adapters for realtime Soup: the Kafka patch publisher, current
//! entity-access expansion, agent-session lookups and, with the `consumer`
//! feature, the Kafka consumer of recipient-targeted patches.

/// Current entity-access expansion adapter.
pub mod entity_access;
/// Kafka-backed realtime Soup publisher adapter.
pub mod kafka_publisher;
/// Independent Kafka consumer for recipient-targeted Soup messages.
#[cfg(feature = "consumer")]
pub mod soup_consumer;

/// Session dependencies for PR updates.
pub mod agent_sessions;

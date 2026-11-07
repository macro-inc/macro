#![deny(missing_docs)]
//! The Kafka consumer that turns Soup-affecting entity events into
//! recipient-targeted Soup patches, driving `soup_realtime_core`'s service.
//!
//! It starts no tasks itself; the composition root calls
//! [`kafka_consumer::run_entity_update_consumer`].

/// Kafka consumer for events that change Soup items.
pub mod kafka_consumer;

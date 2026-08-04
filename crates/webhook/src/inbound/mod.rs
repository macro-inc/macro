//! Inbound adapters: HTTP handlers, the Kafka event consumer, and queue worker.

#[cfg(feature = "inbound")]
pub mod axum_router;

#[cfg(feature = "consumer")]
pub mod kafka_consumer;

#[cfg(feature = "worker")]
pub mod worker;

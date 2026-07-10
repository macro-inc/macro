//! Inbound adapters: HTTP handlers, the Kafka event consumer, and queue worker.

#[cfg(feature = "inbound")]
pub mod axum_router;

#[cfg(all(test, feature = "inbound"))]
mod axum_router_test;

#[cfg(feature = "consumer")]
pub mod kafka_consumer;

#[cfg(feature = "worker")]
pub mod worker;

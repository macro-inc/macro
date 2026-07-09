//! Inbound adapters: HTTP handlers and the Kafka event consumer.

#[cfg(feature = "inbound")]
pub mod axum_router;

#[cfg(all(test, feature = "inbound"))]
mod axum_router_test;

#[cfg(feature = "consumer")]
pub mod kafka_consumer;

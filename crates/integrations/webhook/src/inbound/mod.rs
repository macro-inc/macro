//! Inbound adapters: HTTP handlers, the Kafka event consumer, and queue worker.

#[cfg(feature = "inbound")]
pub mod axum_router;

#[cfg(feature = "consumer")]
pub mod kafka_consumer;

#[cfg(feature = "stream")]
pub mod kafka_stream_consumer;

#[cfg(feature = "stream")]
pub mod stream_router;

#[cfg(feature = "worker")]
pub mod worker;

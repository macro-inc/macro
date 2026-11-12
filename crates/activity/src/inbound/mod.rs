//! Inbound adapters.

#[cfg(feature = "axum")]
pub mod axum_router;
#[cfg(feature = "consumer")]
pub mod kafka_consumer;

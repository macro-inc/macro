//! Inbound adapters for the teams domain.

#[cfg(feature = "axum")]
pub mod axum_router;

#[cfg(feature = "ai_tools")]
pub mod toolset;

#[cfg(feature = "kafka_consumer")]
pub mod teammate_dms_consumer;
